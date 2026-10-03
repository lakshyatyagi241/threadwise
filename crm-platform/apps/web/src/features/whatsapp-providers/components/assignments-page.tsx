'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  Spinner,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, providersApi } from '../api/client';
import { useProviders, useRefreshAll, useWapAccess } from '../api/hooks';
import type { AssignmentPreview, AssignmentRow, Provider } from '../api/schemas';
import { groupDryRun, toggleAll, toggleOne } from '../lib/bulk-dry-run';
import { errorView } from '../lib/errors';
import { targetsFor } from '../lib/health';
import { useWriteError } from './provider-actions';
import { DefaultBadge, Section } from './parts';

/** Which provider each workspace's channels go through: the platform default, with per-workspace overrides and a safe bulk change. */
export function AssignmentsPage() {
  const t = useTranslations('whatsapp-providers.assignments');
  const { access, ready } = useWapAccess();
  const providers = useProviders();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string[] | null>(null);

  // Search is sent to the server (the list is cursor-paged and can be large); wait for the typing to pause.
  useEffect(() => {
    const id = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const q = useInfiniteQuery({
    queryKey: KEYS.assignments(term),
    queryFn: ({ pageParam, signal }) => providersApi.assignments(term, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((pg) => pg.data) ?? [], [q.data]);
  const shownIds = useMemo(() => rows.map((r) => r.workspaceId), [rows]);
  const allOn = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const list = providers.data?.data ?? [];
  const canAssign = access.assign;

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
      {ready && !canAssign && <Alert tone="info">{t('readOnly')}</Alert>}

      <DefaultSelector providers={list} loading={providers.isPending} canChange={access.manage} />

      <Section title={t('table.title')} description={t('table.description')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            type="search"
            className="max-w-xs"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {canAssign && selected.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-2"
              role="region"
              aria-label={t('bulk.label')}
            >
              <span className="text-sm" aria-live="polite">
                {t('bulk.selected', { count: selected.size })}
              </span>
              <Button size="sm" onClick={() => setDialog([...selected])}>
                {t('bulk.change')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('bulk.clear')}
              </Button>
            </div>
          )}
        </div>

        {q.isPending ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={term ? t('emptySearchTitle') : t('emptyTitle')}
            message={term ? t('emptySearchMessage', { term }) : t('emptyMessage')}
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">{t('table.title')}</caption>
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {canAssign && (
                      <th scope="col" className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={t('table.selectAll')}
                          className="size-4 accent-[var(--primary)]"
                          checked={allOn}
                          onChange={() => setSelected((s) => toggleAll(shownIds, s))}
                        />
                      </th>
                    )}
                    {(['workspace', 'provider', 'source', 'channels'] as const).map((c) => (
                      <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">
                        {t(`table.columns.${c}`)}
                      </th>
                    ))}
                    {canAssign && <th scope="col" className="px-3 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <WorkspaceRow
                      key={r.workspaceId}
                      row={r}
                      canAssign={canAssign}
                      checked={selected.has(r.workspaceId)}
                      onCheck={() => setSelected((s) => toggleOne(r.workspaceId, s))}
                      onChange={() => setDialog([r.workspaceId])}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {q.hasNextPage && (
              <Button
                variant="secondary"
                size="sm"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage && <Spinner label={t('loading')} />}
                {t('loadMore')}
              </Button>
            )}
          </>
        )}
      </Section>

      {dialog && (
        <ChangeDialog
          workspaceIds={dialog}
          providers={list}
          names={Object.fromEntries(rows.map((r) => [r.workspaceId, r.workspaceName]))}
          onClose={() => setDialog(null)}
          onApplied={() => {
            setDialog(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function WorkspaceRow({
  row: r,
  canAssign,
  checked,
  onCheck,
  onChange,
}: {
  row: AssignmentRow;
  canAssign: boolean;
  checked: boolean;
  onCheck: () => void;
  onChange: () => void;
}) {
  const t = useTranslations('whatsapp-providers.assignments.table');
  return (
    <tr data-testid={`assignment-${r.workspaceSlug ?? r.workspaceId}`}>
      {canAssign && (
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            aria-label={t('select', { name: r.workspaceName })}
            className="size-4 accent-[var(--primary)]"
            checked={checked}
            onChange={onCheck}
          />
        </td>
      )}
      <td className="px-3 py-2.5">
        <div className="font-medium">{r.workspaceName}</div>
        {r.workspaceSlug && (
          <div dir="ltr" className="font-mono text-xs text-muted-foreground">
            {r.workspaceSlug}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {r.effectiveProviderLabel}
        <span dir="ltr" className="ms-2 font-mono text-xs text-muted-foreground">
          {r.effectiveProviderKey}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={r.isOverride ? 'warning' : 'neutral'}>
          {r.isOverride ? t('override') : t('followsDefault')}
        </Badge>
      </td>
      <td className="px-3 py-2.5 tabular-nums">{r.channelCount}</td>
      {canAssign && (
        <td className="px-3 py-2.5 text-end">
          <Button variant="secondary" size="sm" onClick={onChange}>
            {t('change')}
          </Button>
        </td>
      )}
    </tr>
  );
}

/** The platform default: who serves every workspace without an override. Changing it moves nothing that already exists. */
function DefaultSelector({
  providers,
  loading,
  canChange,
}: {
  providers: Provider[];
  loading: boolean;
  canChange: boolean;
}) {
  const t = useTranslations('whatsapp-providers.assignments.default');
  const toast = useToast();
  const refresh = useRefreshAll();
  const onError = useWriteError();
  const current = providers.find((p) => p.isDefault);
  const choices = targetsFor(providers, current?.id);
  const [pick, setPick] = useState('');
  const [confirm, setConfirm] = useState(false);
  const target = providers.find((p) => p.id === pick);

  const mutation = useMutation({
    mutationFn: () => providersApi.makeDefault(target!.id, target!.rowVersion),
    onSuccess: (p) => {
      toast.success(t('done', { label: p.label }));
      setConfirm(false);
      setPick('');
      void refresh();
    },
    onError: (e) => {
      setConfirm(false);
      onError(e);
    },
  });

  return (
    <Section title={t('title')} description={t('description')} id="default-provider">
      {loading ? (
        <LoadingBlock className="flex min-h-12 items-center text-muted-foreground" />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('current')}</p>
            <p className="flex items-center gap-2 font-medium">
              {current ? (
                <>
                  {current.label}
                  <DefaultBadge />
                </>
              ) : (
                t('none')
              )}
            </p>
          </div>
          {canChange && (
            <>
              <div className="min-w-56 flex-1 space-y-1 sm:max-w-xs">
                <label htmlFor="new-default" className="text-xs text-muted-foreground">
                  {t('change')}
                </label>
                <Select id="new-default" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{t('choose')}</option>
                  {choices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button disabled={!target} onClick={() => setConfirm(true)}>
                {t('apply')}
              </Button>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('confirm.title', { label: target?.label ?? '' })}
        message={
          <div className="space-y-2">
            <p>{t('confirm.newOnly')}</p>
            <p>{t('confirm.existing')}</p>
            <p>{t('confirm.overrides')}</p>
          </div>
        }
        confirmLabel={t('confirm.confirm')}
        cancelLabel={t('confirm.cancel')}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onClose={() => setConfirm(false)}
      />
    </Section>
  );
}

const FOLLOW = '__default__';

/** Pick a provider (or "follow the default"), see the dry run, then apply to the workspaces that would change. */
function ChangeDialog({
  workspaceIds,
  providers,
  names,
  onClose,
  onApplied,
}: {
  workspaceIds: string[];
  providers: Provider[];
  names: Record<string, string>;
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useTranslations('whatsapp-providers.assignments.dialog');
  const tc = useTranslations('whatsapp-providers.assignments.conflicts');
  const te = useTranslations('whatsapp-providers.errors');
  const toast = useToast();
  const refresh = useRefreshAll();
  const [choice, setChoice] = useState('');
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const groups = useMemo(() => (preview ? groupDryRun(preview) : null), [preview]);
  const providerId = choice === FOLLOW ? null : choice;
  const active = providers.filter((p) => p.status === 'active');

  const dry = useMutation({
    mutationFn: () => providersApi.changeAssignments({ workspaceIds, providerId, dryRun: true }),
    onSuccess: (p) => {
      setPreview(p);
      setProblem(null);
    },
    onError: (e) => setProblem(te(errorView(e).kind)),
  });
  const apply = useMutation({
    mutationFn: () =>
      providersApi.changeAssignments({ workspaceIds: groups!.applyIds, providerId, dryRun: false }),
    onSuccess: () => {
      toast.success(t('done', { count: groups!.applyIds.length }));
      void refresh();
      onApplied();
    },
    onError: (e) => setProblem(te(errorView(e).kind)),
  });

  const label = (id: string) => names[id] ?? id;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('title', { count: workspaceIds.length })}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={apply.isPending}>
            {t('cancel')}
          </Button>
          {!groups ? (
            <Button disabled={!choice || dry.isPending} onClick={() => dry.mutate()}>
              {dry.isPending && <Spinner label={t('previewing')} />}
              {t('preview')}
            </Button>
          ) : (
            <Button disabled={!groups.canApply || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending && <Spinner label={t('applying')} />}
              {t('apply', { count: groups.applyIds.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="assign-target" className="text-sm font-medium">
            {t('target')}
          </label>
          <Select
            id="assign-target"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">{t('choose')}</option>
            <option value={FOLLOW}>{t('followDefault')}</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('targetHelp')}</p>
        </div>
        {problem && <Alert tone="danger">{problem}</Alert>}
        {groups && preview && (
          <div className="space-y-3" aria-live="polite" data-testid="assignment-preview">
            <Alert tone={groups.conflicts.length ? 'warning' : 'info'} className="space-y-1">
              <p className="font-medium">
                {t('summary', {
                  workspaces: groups.change.length,
                  channels: groups.channelsAffected,
                })}
              </p>
              {groups.unchanged.length > 0 && (
                <p>{t('unchanged', { count: groups.unchanged.length })}</p>
              )}
              {groups.leaving.map((l) => (
                <p key={l.label}>
                  {t('leaving', {
                    label: l.label || t('unknownProvider'),
                    workspaces: l.workspaces,
                    channels: l.channels,
                  })}
                </p>
              ))}
            </Alert>
            {groups.conflictsByCode.map((c) => (
              <Alert key={c.code} tone="danger" className="space-y-1">
                <p className="font-medium">{tc(`${c.code}`, { count: c.rows.length })}</p>
                <p className="text-xs">
                  {c.rows.map((r) => label(r.workspaceId) || r.workspaceName).join(', ')}
                </p>
              </Alert>
            ))}
            {groups.conflicts.length > 0 && (
              <p className="text-sm text-muted-foreground">{t('conflictsSkipped')}</p>
            )}
            {!groups.canApply && (
              <p className="text-sm text-muted-foreground">{t('nothingToApply')}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
