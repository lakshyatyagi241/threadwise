'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceAssignment } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useDebounced } from '@/features/roles-permissions/lib/use-debounced';
import { clearAssignment, fetchAssignments, fetchProviders, setAssignment, wapKeys } from '../api';
import { wapError } from '../lib/errors';
import type { WapAccess } from '../lib/permissions';
import { selectableProviders } from '../lib/provider-view';
import { ErrorLine, Failure, LoadingBlock, WapGate, useErrorText } from './ui';

const NS = 'whatsapp-providers.assignments';

/** Operator console: which provider each workspace's NEW numbers connect through, and who has numbers elsewhere. */
export function AssignmentsPage() {
  return <WapGate need={['view']}>{(access) => <Assignments access={access} />}</WapGate>;
}

function Assignments({ access }: { access: WapAccess }) {
  const t = useTranslations(NS);
  const [search, setSearch] = useState('');
  const [overrideOnly, setOverrideOnly] = useState(false);
  const settled = useDebounced(search.trim(), 300);

  const q = useInfiniteQuery({
    queryKey: wapKeys.assignments(settled, overrideOnly),
    queryFn: ({ pageParam, signal }) =>
      fetchAssignments({ search: settled, overrideOnly, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const nextPageError: unknown = q.isFetchNextPageError ? q.error : null;
  const registryDefault = q.data?.pages[0]?.registryDefault ?? null;
  const [editing, setEditing] = useState<WorkspaceAssignment | null>(null);
  const [clearing, setClearing] = useState<WorkspaceAssignment | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      {q.data && (
        <Alert tone="info" className="space-y-1">
          <p>
            {registryDefault ? t('defaultIs', { name: registryDefault.label }) : t('noDefault')}
          </p>
          <p className="text-xs text-muted-foreground">{t('existingNote')}</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Checkbox
          id="override-only"
          checked={overrideOnly}
          onChange={(e) => setOverrideOnly(e.target.checked)}
          label={t('overrideOnly')}
        />
      </div>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={settled || overrideOnly ? t('noMatchTitle') : t('emptyTitle')}
          message={settled || overrideOnly ? t('noMatchMessage') : t('emptyMessage')}
        />
      ) : (
        <>
          <AssignmentsTable rows={rows} access={access} onSet={setEditing} onClear={setClearing} />
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
          {nextPageError !== null && <ErrorLine error={nextPageError} />}
        </>
      )}

      <SetOverrideModal workspace={editing} onClose={() => setEditing(null)} />
      <ClearOverrideDialog workspace={clearing} onClose={() => setClearing(null)} />
    </div>
  );
}

function AssignmentsTable({
  rows,
  access,
  onSet,
  onClear,
}: {
  rows: WorkspaceAssignment[];
  access: WapAccess;
  onSet: (w: WorkspaceAssignment) => void;
  onClear: (w: WorkspaceAssignment) => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const linkClass =
    'inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.workspace')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.override')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.effective')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.numbers')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              <span className="sr-only">{t('cols.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((w) => (
            <tr key={w.workspaceId} data-testid={`workspace-${w.slug}`}>
              <th scope="row" className="px-3 py-3 text-start font-normal">
                <div className="font-medium">{w.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{w.slug}</div>
              </th>
              <td className="px-3 py-3">
                {w.override ? (
                  <div>
                    <Badge tone="success">{w.override.label}</Badge>
                    {w.assignedAt && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {format.dateTime(new Date(w.assignedAt), { dateStyle: 'medium' })}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('followsDefault')}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <div>{w.effective.provider?.label ?? w.effective.providerKey}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`source.${w.effective.source}`)}
                </div>
              </td>
              <td className="px-3 py-3 text-end tabular-nums">
                <div>{t('numberCount', { count: w.numberCount })}</div>
                {w.numbersOnOtherProvider > 0 && (
                  <Badge tone="warning" className="mt-0.5">
                    {t('onOther', { count: w.numbersOnOtherProvider })}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {access.manage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`set-override-${w.slug}`}
                      onClick={() => onSet(w)}
                    >
                      {w.override ? t('change') : t('setOverride')}
                    </Button>
                  )}
                  {access.manage && w.override && (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`clear-override-${w.slug}`}
                      onClick={() => onClear(w)}
                    >
                      {t('clear')}
                    </Button>
                  )}
                  {access.switch && w.numberCount > 0 && (
                    <Link
                      href={`/admin/whatsapp-providers/switch?${new URLSearchParams({ workspace: w.workspaceId, name: w.name })}`}
                      className={linkClass}
                    >
                      {t('switch')}
                    </Link>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetOverrideModal({
  workspace,
  onClose,
}: {
  workspace: WorkspaceAssignment | null;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.set`);
  const tc = useTranslations(`${NS}.common`);
  const toast = useToast();
  const qc = useQueryClient();
  const providerId = useId();
  const noteId = useId();
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const providers = useQuery({
    queryKey: wapKeys.list,
    queryFn: ({ signal }) => fetchProviders(signal),
    enabled: workspace !== null,
    refetchOnWindowFocus: false,
  });
  const options = useMemo(() => selectableProviders(providers.data?.data ?? []), [providers.data]);
  const chosen = pick ?? workspace?.override?.id ?? options[0]?.id ?? '';

  const save = useMutation({
    mutationFn: () =>
      setAssignment(workspace!.workspaceId, {
        providerId: chosen,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async (w) => {
      toast.success(t('done', { workspace: w.name, provider: w.override?.label ?? '' }));
      await qc.invalidateQueries({ queryKey: wapKeys.all });
      close();
    },
    onError: (e) => {
      if (wapError(e).kind === 'conflict' || wapError(e).key === 'disabled') {
        void qc.invalidateQueries({ queryKey: wapKeys.all });
      }
    },
  });

  const close = () => {
    setPick(null);
    setNote('');
    save.reset();
    onClose();
  };

  return (
    <Modal
      open={workspace !== null}
      onClose={() => {
        if (!save.isPending) close();
      }}
      title={t('title', { name: workspace?.name ?? '' })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || chosen === ''}>
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('help')}</p>
        {providers.isPending ? (
          <LoadingBlock />
        ) : providers.isError ? (
          <Failure error={providers.error} onRetry={() => void providers.refetch()} />
        ) : options.length === 0 ? (
          <Alert tone="warning">{t('noActive')}</Alert>
        ) : (
          <Field label={t('provider')} htmlFor={providerId}>
            <Select id={providerId} value={chosen} onChange={(e) => setPick(e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.key})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('note')} htmlFor={noteId} hint={t('noteHint')}>
          <Input
            id={noteId}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            autoComplete="off"
          />
        </Field>
        {save.isError && <ErrorLine error={save.error} />}
      </div>
    </Modal>
  );
}

function ClearOverrideDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceAssignment | null;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.clearDialog`);
  const tc = useTranslations(`${NS}.common`);
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const run = useMutation({
    mutationFn: () => clearAssignment(workspace!.workspaceId),
    onSuccess: async (w) => {
      toast.success(t('done', { workspace: w.name }));
      await qc.invalidateQueries({ queryKey: wapKeys.all });
      onClose();
    },
    onError: (e) => {
      toast.error(errorText(e).text);
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open={workspace !== null}
      title={t('title', { name: workspace?.name ?? '' })}
      message={t('body', {
        name: workspace?.name ?? '',
        provider: workspace?.override?.label ?? '',
      })}
      confirmLabel={t('action')}
      cancelLabel={tc('cancel')}
      busy={run.isPending}
      onConfirm={() => run.mutate()}
      onClose={onClose}
    />
  );
}
