'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  cn,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { KEYS, providersApi } from '../api/client';
import { useProviders, useRefreshAll, useWapAccess } from '../api/hooks';
import type { Provider, ProviderChannel, SwitchResult } from '../api/schemas';
import { toggleAll, toggleOne } from '../lib/bulk-dry-run';
import { errorView } from '../lib/errors';
import { targetsFor } from '../lib/health';
import {
  canApplySwitch,
  confirmationMatches,
  movableIds,
  needsForce,
  outcome,
  resultView,
  retryIds,
  summarize,
  switchCodeKey,
} from '../lib/switch';
import { Section } from './parts';

type Phase = 'choose' | 'test' | 'confirm' | 'result';
const PHASES: readonly Phase[] = ['choose', 'test', 'confirm', 'result'];

/**
 * "Move channels to another provider": choose the channels, test that the target provider reaches each one (a dry run that
 * changes nothing), review the warnings, confirm by typing the target's key, then read the result per channel.
 */
export function SwitchWizard({
  initialFrom,
  workspaceId,
}: {
  initialFrom?: string;
  workspaceId?: string;
}) {
  const t = useTranslations('whatsapp-providers.switch');
  const te = useTranslations('whatsapp-providers.errors');
  const { access, ready } = useWapAccess();
  const providers = useProviders();
  const refresh = useRefreshAll();

  const [phase, setPhase] = useState<Phase>('choose');
  const [fromId, setFromId] = useState(initialFrom ?? '');
  const [toId, setToId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dry, setDry] = useState<SwitchResult | null>(null);
  const [force, setForce] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<SwitchResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const list = providers.data?.data ?? [];
  const from = list.find((p) => p.id === fromId);
  const to = list.find((p) => p.id === toId);
  const targets = targetsFor(list, fromId);

  const channelsQuery = useInfiniteQuery({
    queryKey: KEYS.channels(fromId),
    queryFn: ({ pageParam, signal }) => providersApi.channels(fromId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: !!fromId,
    refetchOnWindowFocus: false,
  });
  const channels = useMemo(() => {
    const all = channelsQuery.data?.pages.flatMap((pg) => pg.data) ?? [];
    return workspaceId ? all.filter((c) => c.workspaceId === workspaceId) : all;
  }, [channelsQuery.data, workspaceId]);

  // Leaving mid-way is safe (nothing changes until the real run) but a half-made selection is worth a warning.
  useUnsavedGuard(phase !== 'result' && selected.size > 0 && phase !== 'choose');

  const run = useMutation({
    mutationFn: (opts: { dryRun: boolean; ids: string[] }) =>
      providersApi.switchProvider({
        targetProviderId: toId,
        channelIds: opts.ids,
        dryRun: opts.dryRun,
        force,
        confirmKey: opts.dryRun ? undefined : typed.trim(),
      }),
    onError: (e) => setProblem(te(errorView(e).kind)),
  });

  const reset = () => {
    setDry(null);
    setForce(false);
    setTyped('');
    setProblem(null);
  };

  const startTest = () => {
    setProblem(null);
    run.mutate(
      { dryRun: true, ids: [...selected] },
      {
        onSuccess: (r) => {
          setDry(r);
          setPhase('test');
        },
      },
    );
  };

  const apply = () => {
    if (!dry) return;
    setProblem(null);
    run.mutate(
      { dryRun: false, ids: movableIds(dry.results, force) },
      {
        onSuccess: (r) => {
          setDone(r);
          setPhase('result');
          void refresh();
        },
      },
    );
  };

  if (ready && !access.switch) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} />
        <Alert tone="warning">{t('noAccess')}</Alert>
      </div>
    );
  }

  const index = PHASES.indexOf(phase);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/admin/whatsapp-providers">
            <Button variant="secondary" size="sm">
              {t('backToProviders')}
            </Button>
          </Link>
        }
      />
      <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
        {PHASES.map((s, i) => (
          <li
            key={s}
            aria-current={s === phase ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
              s === phase
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : i < index
                  ? 'border-border text-foreground'
                  : 'border-border text-muted-foreground',
            )}
          >
            <span className="tabular-nums">{i + 1}</span>
            <span>{t(`steps.${s}`)}</span>
          </li>
        ))}
      </ol>
      {problem && <Alert tone="danger">{problem}</Alert>}

      {phase === 'choose' && (
        <Section title={t('choose.title')} description={t('choose.description')}>
          {providers.isPending ? (
            <LoadingBlock />
          ) : providers.isError ? (
            <ErrorBlock error={providers.error} onRetry={() => void providers.refetch()} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('choose.from')} htmlFor="switch-from" hint={t('choose.fromHint')}>
                <Select
                  id="switch-from"
                  value={fromId}
                  onChange={(e) => {
                    setFromId(e.target.value);
                    setToId('');
                    setSelected(new Set());
                  }}
                >
                  <option value="">{t('choose.pick')}</option>
                  {list
                    .filter((p) => p.channelCount > 0)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} ({p.channelCount})
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t('choose.to')} htmlFor="switch-to" hint={t('choose.toHint')}>
                <Select
                  id="switch-to"
                  value={toId}
                  disabled={!fromId}
                  onChange={(e) => {
                    setToId(e.target.value);
                    reset();
                  }}
                >
                  <option value="">{t('choose.pick')}</option>
                  {targets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {workspaceId && <Alert tone="info">{t('choose.workspaceOnly')}</Alert>}
          {fromId && (
            <ChannelPicker
              loading={channelsQuery.isPending}
              error={channelsQuery.isError ? channelsQuery.error : null}
              channels={channels}
              selected={selected}
              setSelected={setSelected}
              hasMore={!!channelsQuery.hasNextPage}
              loadingMore={channelsQuery.isFetchingNextPage}
              loadMore={() => void channelsQuery.fetchNextPage()}
              onRetry={() => void channelsQuery.refetch()}
            />
          )}
          <div className="flex justify-end">
            <Button disabled={!to || selected.size === 0 || run.isPending} onClick={startTest}>
              {run.isPending && <Spinner label={t('test.running')} />}
              {t('choose.next', { count: selected.size })}
            </Button>
          </div>
        </Section>
      )}

      {phase === 'test' && dry && to && (
        <TestStep
          result={dry}
          to={to}
          force={force}
          setForce={setForce}
          onBack={() => {
            setPhase('choose');
            reset();
          }}
          onRetest={startTest}
          retesting={run.isPending}
          onNext={() => setPhase('confirm')}
        />
      )}

      {phase === 'confirm' && dry && to && from && (
        <ConfirmStep
          from={from}
          to={to}
          count={movableIds(dry.results, force).length}
          typed={typed}
          setTyped={setTyped}
          busy={run.isPending}
          onBack={() => setPhase('test')}
          onApply={apply}
        />
      )}

      {phase === 'result' && done && from && to && (
        <ResultStep
          result={done}
          from={from}
          to={to}
          onRetry={() => {
            setSelected(new Set(retryIds(done)));
            setDone(null);
            reset();
            setPhase('choose');
          }}
        />
      )}
    </div>
  );
}

function ChannelPicker({
  loading,
  error,
  channels,
  selected,
  setSelected,
  hasMore,
  loadingMore,
  loadMore,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  channels: ProviderChannel[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('whatsapp-providers.switch.choose');
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? channels.filter((c) =>
          `${c.workspaceName} ${c.label} ${c.phoneDisplay ?? ''}`.toLowerCase().includes(q),
        )
      : channels;
  }, [channels, search]);
  const ids = shown.map((c) => c.channelId);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (channels.length === 0)
    return <EmptyState title={t('noChannelsTitle')} message={t('noChannelsMessage')} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {t('selected', { count: selected.size })}
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={t('selectAll')}
                  className="size-4 accent-[var(--primary)]"
                  checked={allOn}
                  onChange={() => setSelected(toggleAll(ids, selected))}
                />
              </th>
              {(['workspace', 'channel', 'status', 'queued'] as const).map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                  {t(`columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((c) => (
              <tr key={c.channelId}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('select', { name: c.label })}
                    className="size-4 accent-[var(--primary)]"
                    checked={selected.has(c.channelId)}
                    onChange={() => setSelected(toggleOne(c.channelId, selected))}
                  />
                </td>
                <td className="px-3 py-2">{c.workspaceName}</td>
                <td className="px-3 py-2">
                  {c.label}
                  {c.phoneDisplay && (
                    <span dir="ltr" className="ms-2 font-mono text-xs text-muted-foreground">
                      {c.phoneDisplay}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge>{c.status}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{c.queuedMessages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <Button variant="secondary" size="sm" disabled={loadingMore} onClick={loadMore}>
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SwitchResult['results'][number]['status'] }) {
  const t = useTranslations('whatsapp-providers.switch.status');
  const v = resultView(status);
  return <Badge tone={v.tone}>{t(v.key)}</Badge>;
}

function ResultTable({ result }: { result: SwitchResult }) {
  const t = useTranslations('whatsapp-providers.switch.results');
  const tc = useTranslations('whatsapp-providers.switch.codes');
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[36rem] text-sm" data-testid="switch-results">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {(['workspace', 'channel', 'status', 'detail'] as const).map((c) => (
              <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                {t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.results.map((r) => (
            <tr key={r.channelId}>
              <td className="px-3 py-2">{r.workspaceName}</td>
              <td className="px-3 py-2">{r.label}</td>
              <td className="px-3 py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {r.code ? tc(switchCodeKey(r.code)) : ''}
                {r.queuedMessages > 0 && ` ${t('queued', { count: r.queuedMessages })}`}
                {r.code && switchCodeKey(r.code) === 'unknown' && (
                  <span dir="ltr" className="ms-1 font-mono">
                    {r.code}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestStep({
  result,
  to,
  force,
  setForce,
  onBack,
  onRetest,
  retesting,
  onNext,
}: {
  result: SwitchResult;
  to: Provider;
  force: boolean;
  setForce: (v: boolean) => void;
  onBack: () => void;
  onRetest: () => void;
  retesting: boolean;
  onNext: () => void;
}) {
  const t = useTranslations('whatsapp-providers.switch.test');
  const s = summarize(result.results);
  return (
    <Section title={t('title', { label: to.label })} description={t('description')}>
      <Alert tone={s.blocked > 0 || s.failed > 0 ? 'warning' : 'info'} aria-live="polite">
        {t('summary', { ready: s.ready, warnings: s.warnings, blocked: s.blocked })}
      </Alert>
      <ResultTable result={result} />
      {needsForce(result.results) && (
        <Alert tone="warning" className="space-y-2">
          <p className="font-medium">{t('queueTitle')}</p>
          <p>{t('queueBody', { count: s.queuedMessages })}</p>
          <Checkbox
            id="switch-force"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            label={t('force')}
          />
        </Alert>
      )}
      {s.blocked > 0 && <p className="text-sm text-muted-foreground">{t('blockedNote')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          {t('back')}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRetest} disabled={retesting}>
            {retesting && <Spinner label={t('running')} />}
            {t('retest')}
          </Button>
          <Button disabled={!canApplySwitch(result.results, force)} onClick={onNext}>
            {t('next', { count: movableIds(result.results, force).length })}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function ConfirmStep({
  from,
  to,
  count,
  typed,
  setTyped,
  busy,
  onBack,
  onApply,
}: {
  from: Provider;
  to: Provider;
  count: number;
  typed: string;
  setTyped: (v: string) => void;
  busy: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  const t = useTranslations('whatsapp-providers.switch.confirm');
  const ok = confirmationMatches(typed, to.key);
  return (
    <Section
      title={t('title')}
      description={t('description', { count, from: from.label, to: to.label })}
    >
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        <li>{t('effect1')}</li>
        <li>{t('effect2')}</li>
        <li>{t('effect3')}</li>
      </ul>
      <Field label={t('typeLabel', { key: to.key })} htmlFor="switch-confirm" hint={t('typeHint')}>
        <Input
          id="switch-confirm"
          dir="ltr"
          className="font-mono"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          {t('back')}
        </Button>
        <Button variant="danger" disabled={!ok || busy} onClick={onApply}>
          {busy && <Spinner label={t('moving')} />}
          {t('move', { count })}
        </Button>
      </div>
    </Section>
  );
}

function ResultStep({
  result,
  from,
  to,
  onRetry,
}: {
  result: SwitchResult;
  from: Provider;
  to: Provider;
  onRetry: () => void;
}) {
  const t = useTranslations('whatsapp-providers.switch.done');
  const o = outcome(result);
  const retry = retryIds(result).length;
  return (
    <Section
      title={t(`title.${o.kind}`)}
      description={t('summary', { switched: o.summary.switched, total: o.summary.total })}
    >
      <ResultTable result={result} />
      {o.rollback && (
        <Alert tone="info" className="space-y-1">
          <p className="font-medium">{t('rollbackTitle')}</p>
          <p>{t('rollbackBody', { from: from.label, to: to.label })}</p>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/whatsapp-providers">
          <Button variant="secondary">{t('toProviders')}</Button>
        </Link>
        {retry > 0 && <Button onClick={onRetry}>{t('retry', { count: retry })}</Button>}
      </div>
    </Section>
  );
}
