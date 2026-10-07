'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProviderSummary,
  SwitchNumberOutcome,
  SwitchWorkspaceProviderResponse,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useDebounced } from '@/features/roles-permissions/lib/use-debounced';
import { fetchAssignments, fetchProviders, switchWorkspace, wapKeys } from '../api';
import { wapError } from '../lib/errors';
import { sortProviders } from '../lib/provider-view';
import {
  REQUIREMENT_KEYS,
  buildSwitchRequest,
  canDryRun,
  formSignature,
  isBlockingRequirement,
  numberIdsToApply,
  rollbackForm,
  summarizePlan,
  summarizeResult,
  type SwitchForm,
} from '../lib/switch-plan';
import { ErrorLine, Failure, LoadingBlock, Section, WapGate } from './ui';

const NS = 'whatsapp-providers.switch';

interface WorkspaceRef {
  id: string;
  name: string | null;
}

interface Props {
  /** `?workspace=` : a workspace to start on. */
  workspaceId?: string;
  /** `?name=` : its display name, when the link knows it. */
  workspaceName?: string;
  /** `?target=` : the provider to move to. */
  targetId?: string;
}

/**
 * Operator console: move a workspace's connected WhatsApp numbers to another provider. Choose the workspace and the target, run
 * a dry run (nothing changes, nothing is called) that lists each number and what it still needs, tick what to move, confirm
 * explicitly, then apply and read the per-number result and the way back. Needs `.view` and `.switch`.
 */
export function SwitchPage(props: Props) {
  return <WapGate need={['view', 'switch']}>{() => <Switcher {...props} />}</WapGate>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Switcher({ workspaceId, workspaceName, targetId }: Props) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const targetFieldId = useId();
  const fromFieldId = useId();
  const reasonId = useId();

  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(
    workspaceId && UUID.test(workspaceId)
      ? { id: workspaceId, name: workspaceName?.slice(0, 120) || null }
      : null,
  );
  const [form, setForm] = useState<SwitchForm>({
    targetProviderId: targetId && UUID.test(targetId) ? targetId : '',
    fromProviderId: '',
    setOverride: false,
    reason: '',
  });
  const [plan, setPlan] = useState<{
    signature: string;
    response: SwitchWorkspaceProviderResponse;
  } | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [understood, setUnderstood] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SwitchWorkspaceProviderResponse | null>(null);

  const providers = useQuery({
    queryKey: wapKeys.list,
    queryFn: ({ signal }) => fetchProviders(signal),
    refetchOnWindowFocus: false,
  });
  const all = useMemo(() => sortProviders(providers.data?.data ?? []), [providers.data]);
  const targets = useMemo(
    () => all.filter((p) => p.status === 'active' || p.id === form.targetProviderId),
    [all, form.targetProviderId],
  );
  const target = all.find((p) => p.id === form.targetProviderId) ?? null;

  const signature = formSignature(workspace?.id ?? '', form);
  const stale = plan !== null && plan.signature !== signature;
  const fresh = plan && !stale ? plan : null;
  const summary = fresh ? summarizePlan(fresh.response) : null;

  const dryRun = useMutation({
    mutationFn: () => switchWorkspace(workspace!.id, buildSwitchRequest(form, { dryRun: true })),
    onSuccess: (response) => {
      setPlan({ signature, response });
      setTicked(new Set(summarizePlan(response).readyIds));
      setUnderstood(false);
    },
    onError: () => setPlan(null),
  });

  const apply = useMutation({
    mutationFn: () => {
      const ids = summary ? numberIdsToApply(summary, ticked) : undefined;
      return switchWorkspace(
        workspace!.id,
        buildSwitchRequest(form, { dryRun: false, numberIds: ids }),
      );
    },
    onSuccess: async (response) => {
      setConfirming(false);
      setResult(response);
      setPlan(null);
      await qc.invalidateQueries({ queryKey: wapKeys.all });
    },
    onError: (e) => {
      setConfirming(false);
      if (wapError(e).key === 'nothingToDo' || wapError(e).key === 'disabled') {
        void qc.invalidateQueries({ queryKey: wapKeys.all });
      }
    },
  });

  const patch = (p: Partial<SwitchForm>) => {
    dryRun.reset();
    apply.reset();
    setForm((f) => ({ ...f, ...p }));
  };

  const startOver = () => {
    setResult(null);
    setPlan(null);
    setUnderstood(false);
    dryRun.reset();
    apply.reset();
  };

  const prepareRollback = (previous: ProviderSummary) => {
    if (!result) return;
    const next = rollbackForm(result, previous);
    if (!next) return;
    startOver();
    setForm(next);
  };

  const readyChosen = summary ? summary.readyIds.filter((id) => ticked.has(id)).length : 0;
  const canApply =
    !!summary && summary.canApply && readyChosen > 0 && understood && !apply.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      {result ? (
        <ResultView
          result={result}
          onStartOver={startOver}
          onRollback={prepareRollback}
          workspaceName={workspace?.name ?? null}
        />
      ) : (
        <>
          <Section id="choose" title={t('choose.title')} description={t('choose.description')}>
            <WorkspacePicker
              workspace={workspace}
              onPick={(w) => {
                setWorkspace(w);
                dryRun.reset();
                setPlan(null);
              }}
            />

            {providers.isPending ? (
              <LoadingBlock />
            ) : providers.isError ? (
              <Failure error={providers.error} onRetry={() => void providers.refetch()} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('choose.target')}
                  htmlFor={targetFieldId}
                  hint={t('choose.targetHint')}
                >
                  <Select
                    id={targetFieldId}
                    value={form.targetProviderId}
                    onChange={(e) => patch({ targetProviderId: e.target.value })}
                  >
                    <option value="">{t('choose.pick')}</option>
                    {targets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} ({p.key}){p.status !== 'active' ? ` - ${p.status}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('choose.from')} htmlFor={fromFieldId} hint={t('choose.fromHint')}>
                  <Select
                    id={fromFieldId}
                    value={form.fromProviderId}
                    onChange={(e) => patch({ fromProviderId: e.target.value })}
                  >
                    <option value="">{t('choose.anyProvider')}</option>
                    {all
                      .filter((p) => p.id !== form.targetProviderId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.key})
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            )}

            <Checkbox
              id="set-override"
              checked={form.setOverride}
              onChange={(e) => patch({ setOverride: e.target.checked })}
              label={
                <span>
                  <span className="font-medium">{t('choose.setOverride')}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('choose.setOverrideHint')}
                  </span>
                </span>
              }
            />
            <Field label={t('choose.reason')} htmlFor={reasonId} hint={t('choose.reasonHint')}>
              <Textarea
                id={reasonId}
                rows={2}
                maxLength={500}
                value={form.reason}
                onChange={(e) => patch({ reason: e.target.value })}
              />
            </Field>

            {target && target.status !== 'active' && (
              <Alert tone="warning">{t('choose.targetNotActive')}</Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!workspace || !canDryRun(workspace.id, form) || dryRun.isPending}
                onClick={() => dryRun.mutate()}
              >
                {dryRun.isPending && <Spinner />}
                {t('choose.dryRun')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('choose.dryRunNote')}</span>
            </div>
            {dryRun.isError && <SwitchError error={dryRun.error} />}
          </Section>

          {stale && <Alert tone="warning">{t('plan.stale')}</Alert>}

          {fresh && summary && (
            <Section id="plan" title={t('plan.title')} description={t('plan.description')}>
              <PlanSummary
                summary={summary}
                target={fresh.response.to}
                workspaceName={workspace?.name ?? null}
              />
              <NumbersTable
                numbers={fresh.response.numbers}
                mode="plan"
                ticked={ticked}
                onToggle={(id, on) =>
                  setTicked((cur) => {
                    const next = new Set(cur);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
              />
              <RequirementAdvice
                present={Object.keys(summary.requirements) as Array<keyof typeof REQUIREMENT_KEYS>}
              />

              {summary.canApply ? (
                <div className="space-y-3 rounded-md border border-border p-4">
                  <h3 className="text-sm font-semibold">{t('apply.title')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('apply.summary', {
                      count: readyChosen,
                      provider: fresh.response.to.label,
                    })}
                  </p>
                  <Checkbox
                    id="understood"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    label={t('apply.understood')}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button disabled={!canApply} onClick={() => setConfirming(true)}>
                      {t('apply.action')}
                    </Button>
                    {readyChosen === 0 && (
                      <span className="text-xs text-muted-foreground">{t('apply.tickOne')}</span>
                    )}
                  </div>
                  {apply.isError && <SwitchError error={apply.error} />}
                </div>
              ) : (
                <Alert tone="warning">{t('plan.nothingReady')}</Alert>
              )}
            </Section>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title={t('confirm.title')}
        message={
          <div className="space-y-2">
            <p>
              {t('confirm.body', {
                count: readyChosen,
                provider: fresh?.response.to.label ?? '',
                workspace: workspace?.name ?? workspace?.id ?? '',
              })}
            </p>
            <p>{t('confirm.rollback')}</p>
          </div>
        }
        confirmLabel={t('confirm.action')}
        cancelLabel={t('confirm.cancel')}
        busy={apply.isPending}
        onConfirm={() => apply.mutate()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function SwitchError({ error }: { error: unknown }) {
  const t = useTranslations(NS);
  const info = wapError(error);
  return (
    <div className="space-y-1">
      <ErrorLine error={error} />
      {info.key === 'nothingToDo' && (
        <p className="text-xs text-muted-foreground">{t('errorHints.nothingToDo')}</p>
      )}
      {info.key === 'tooManyNumbers' && (
        <p className="text-xs text-muted-foreground">{t('errorHints.tooMany')}</p>
      )}
      {info.key === 'disabled' && (
        <p className="text-xs text-muted-foreground">{t('errorHints.disabled')}</p>
      )}
    </div>
  );
}

// --- workspace picker ------------------------------------------------------------------------------------------------------

function WorkspacePicker({
  workspace,
  onPick,
}: {
  workspace: WorkspaceRef | null;
  onPick: (w: WorkspaceRef | null) => void;
}) {
  const t = useTranslations(`${NS}.workspace`);
  const [search, setSearch] = useState('');
  const settled = useDebounced(search.trim(), 300);
  const q = useQuery({
    queryKey: wapKeys.workspacePicker(settled),
    queryFn: ({ signal }) => fetchAssignments({ search: settled, overrideOnly: false }, signal),
    enabled: workspace === null,
    refetchOnWindowFocus: false,
  });
  const name = useId();

  if (workspace) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t('selected')}</div>
          <div className="font-medium">{workspace.name ?? t('unnamed')}</div>
          <div className="font-mono text-xs text-muted-foreground">{workspace.id}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onPick(null)}>
          {t('change')}
        </Button>
      </div>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('label')}</legend>
      <Input
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {q.data.data.map((w) => (
            <li key={w.workspaceId}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                <input
                  type="radio"
                  name={name}
                  className="size-4 accent-[var(--primary)]"
                  onChange={() => onPick({ id: w.workspaceId, name: w.name })}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{w.name}</span>
                  <span className="ms-2 font-mono text-xs text-muted-foreground">{w.slug}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('numbers', { count: w.numberCount })}
                  {w.numbersOnOtherProvider > 0
                    ? ` · ${t('onOther', { count: w.numbersOnOtherProvider })}`
                    : ''}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {q.data?.page.hasMore && <p className="text-xs text-muted-foreground">{t('narrow')}</p>}
    </fieldset>
  );
}

// --- dry run and result views ----------------------------------------------------------------------------------------------

export function PlanSummary({
  summary,
  target,
  workspaceName,
}: {
  summary: ReturnType<typeof summarizePlan>;
  target: ProviderSummary;
  workspaceName: string | null;
}) {
  const t = useTranslations(`${NS}.plan`);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm">
        {t('headline', {
          total: summary.total,
          ready: summary.ready,
          provider: target.label,
          workspace: workspaceName ?? '',
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">{t('ready', { count: summary.ready })}</Badge>
        {summary.blocked > 0 && (
          <Badge tone="danger">{t('blocked', { count: summary.blocked })}</Badge>
        )}
        {summary.failed > 0 && (
          <Badge tone="danger">{t('failed', { count: summary.failed })}</Badge>
        )}
        {summary.needReconnect > 0 && (
          <Badge tone="warning">{t('reconnect', { count: summary.needReconnect })}</Badge>
        )}
      </div>
    </div>
  );
}

export function RequirementAdvice({ present }: { present: Array<keyof typeof REQUIREMENT_KEYS> }) {
  const t = useTranslations(`${NS}.requirements`);
  if (present.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <ul className="space-y-2 text-sm">
        {present.map((r) => (
          <li key={r} className="rounded-md border border-border p-3">
            <p className="font-medium">
              {t(`${REQUIREMENT_KEYS[r]}.label`)}{' '}
              <Badge tone={isBlockingRequirement(r) ? 'danger' : 'warning'}>
                {isBlockingRequirement(r) ? t('blocks') : t('advice')}
              </Badge>
            </p>
            <p className="text-xs text-muted-foreground">{t(`${REQUIREMENT_KEYS[r]}.help`)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE_TONE: Record<
  SwitchNumberOutcome['state'],
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  ready: 'success',
  blocked: 'danger',
  switched: 'success',
  repointed: 'warning',
  failed: 'danger',
};

export function NumbersTable({
  numbers,
  mode,
  ticked,
  onToggle,
}: {
  numbers: SwitchNumberOutcome[];
  mode: 'plan' | 'result';
  ticked?: ReadonlySet<string>;
  onToggle?: (id: string, on: boolean) => void;
}) {
  const t = useTranslations(`${NS}.numbers`);
  const tr = useTranslations(`${NS}.requirements`);
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">
          {mode === 'plan' ? t('captionPlan') : t('captionResult')}
        </caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            {mode === 'plan' && (
              <th scope="col" className="w-10 px-3 py-2 text-start font-medium">
                <span className="sr-only">{t('cols.move')}</span>
              </th>
            )}
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.number')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.from')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.state')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.details')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {numbers.map((n) => {
            const title = n.label ?? n.phoneNumber ?? n.numberId;
            return (
              <tr key={n.numberId}>
                {mode === 'plan' && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={ticked?.has(n.numberId) ?? false}
                      disabled={n.state !== 'ready'}
                      aria-label={t('moveNumber', { name: title })}
                      onChange={(e) => onToggle?.(n.numberId, e.target.checked)}
                    />
                  </td>
                )}
                <th scope="row" className="px-3 py-3 text-start font-normal">
                  <div className="font-medium">{title}</div>
                  {n.label && n.phoneNumber && (
                    <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {n.phoneNumber}
                    </div>
                  )}
                </th>
                <td className="px-3 py-3">{n.from?.label ?? t('unknownProvider')}</td>
                <td className="px-3 py-3">
                  <Badge tone={STATE_TONE[n.state]}>{t(`state.${n.state}`)}</Badge>
                </td>
                <td className="space-y-1 px-3 py-3 text-xs text-muted-foreground">
                  {n.requirements.map((r) => (
                    <p key={r} className={isBlockingRequirement(r) ? 'text-danger' : undefined}>
                      {tr(`${REQUIREMENT_KEYS[r]}.label`)}
                    </p>
                  ))}
                  {mode === 'plan' && n.state === 'ready' && (
                    <p>{n.resubscribe ? t('willResubscribe') : t('willRepoint')}</p>
                  )}
                  {mode === 'result' && n.state === 'switched' && n.inboundWired === false && (
                    <p className="text-warning">{t('inboundNotWired')}</p>
                  )}
                  {mode === 'result' && n.state === 'switched' && n.inboundWired === true && (
                    <p>{t('inboundWired')}</p>
                  )}
                  {n.message && <p dir="auto">{n.message}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ResultView({
  result,
  workspaceName,
  onStartOver,
  onRollback,
}: {
  result: SwitchWorkspaceProviderResponse;
  workspaceName: string | null;
  onStartOver: () => void;
  onRollback: (previous: ProviderSummary) => void;
}) {
  const t = useTranslations(`${NS}.result`);
  const s = summarizeResult(result);
  return (
    <div className="space-y-4">
      <Section id="result" title={t('title')}>
        <Alert tone={s.allMoved ? 'success' : s.noneMoved ? 'danger' : 'warning'}>
          <p className="font-medium">
            {s.allMoved
              ? t('allMoved', { provider: result.to.label, count: s.total })
              : s.noneMoved
                ? t('noneMoved')
                : t('partial', { moved: s.switched + s.repointed, total: s.total })}
          </p>
          {workspaceName && <p className="text-xs">{workspaceName}</p>}
        </Alert>
        <div className="flex flex-wrap gap-2">
          {s.switched > 0 && <Badge tone="success">{t('switched', { count: s.switched })}</Badge>}
          {s.repointed > 0 && (
            <Badge tone="warning">{t('repointed', { count: s.repointed })}</Badge>
          )}
          {s.failed > 0 && <Badge tone="danger">{t('failed', { count: s.failed })}</Badge>}
          {s.blocked > 0 && <Badge tone="danger">{t('blocked', { count: s.blocked })}</Badge>}
        </div>
        {result.overrideSet && (
          <p className="text-sm">{t('overrideSet', { provider: result.to.label })}</p>
        )}
        {s.repointed > 0 && <Alert tone="warning">{t('repointedNote')}</Alert>}
        {s.inboundNotWired > 0 && (
          <Alert tone="warning">{t('inboundNote', { count: s.inboundNotWired })}</Alert>
        )}
        <NumbersTable numbers={result.numbers} mode="result" />
      </Section>

      {!s.noneMoved && (
        <Section id="rollback" title={t('rollback.title')} description={t('rollback.description')}>
          <div className="flex flex-wrap items-center gap-2">
            {s.rollbackTargets.map((p) => (
              <Button key={p.id} variant="secondary" onClick={() => onRollback(p)}>
                {t('rollback.action', { provider: p.label })}
              </Button>
            ))}
            {s.rollbackTargets.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('rollback.unknown')}</p>
            )}
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onStartOver}>{t('another')}</Button>
        <Link
          href="/admin/workspaces"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('toAssignments')}
        </Link>
      </div>
    </div>
  );
}
