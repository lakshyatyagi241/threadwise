'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  unofficialWorkspaceListResponseSchema,
  unofficialWorkspaceOptionListResponseSchema,
  unofficialWorkspaceSchema,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import {
  NOTE_MAX,
  OPTION_LIMIT,
  PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  checkNote,
  panelBanner,
  searchReady,
  searchTerm,
  toOptions,
  toRows,
  type WorkspaceOption,
  type WorkspaceRow,
} from './lib/workspaces';
import { NODE_BRIDGE_QUERY_KEY } from './queries';
import { OptionList, WorkspaceTable } from './workspaces-views';

const NS = 'node-bridge-runtime.workspaces';
export const WORKSPACES_QUERY_KEY = [...NODE_BRIDGE_QUERY_KEY, 'unofficial-workspaces'] as const;
/** The id of the platform switch button in the status card: the banner points at it. */
export const UNOFFICIAL_TOGGLE_ID = 'unofficial-toggle';

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return out;
}

/**
 * "Workspaces with unofficial WhatsApp": the allow-list under the platform switch. The engine is off for every workspace by default;
 * only these workspaces get it, and only while the switch above is on. A super admin searches workspaces to add and removes rows;
 * another operator who may read the list sees it read-only, and one who may not does not see the panel at all (403).
 */
export function WorkspacesPanel({
  platformOn,
  workspaceCount,
  canEdit,
}: {
  platformOn: boolean;
  workspaceCount: number;
  canEdit: boolean;
}) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const searchId = useId();
  const noteId = useId();
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState<WorkspaceOption | null>(null);
  const [removing, setRemoving] = useState<WorkspaceRow | null>(null);
  const [note, setNote] = useState('');
  const term = useDebounced(searchTerm(typed), SEARCH_DEBOUNCE_MS);
  const ready = canEdit && searchReady(term) && searchReady(typed);

  const list = useInfiniteQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/node-bridge/unofficial/workspaces', {
        query: { limit: PAGE_SIZE, cursor: pageParam },
        schema: unofficialWorkspaceListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const rows = useMemo(() => toRows(list.data?.pages.flatMap((p) => p.data) ?? []), [list.data]);

  const options = useQuery({
    queryKey: [...WORKSPACES_QUERY_KEY, 'options', term],
    queryFn: ({ signal }) =>
      operatorFetch('/node-bridge/unofficial/workspace-options', {
        query: { q: term, limit: OPTION_LIMIT },
        schema: unofficialWorkspaceOptionListResponseSchema,
        signal,
      }),
    enabled: ready,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const found = useMemo(() => toOptions(options.data?.data ?? []), [options.data]);

  function closeAll() {
    setAdding(null);
    setRemoving(null);
    setNote('');
  }

  const change = useMutation({
    mutationFn: (input: { orgUuid: string; enabled: boolean; note?: string | undefined }) =>
      operatorFetch(`/node-bridge/unofficial/workspaces/${input.orgUuid}`, {
        method: 'PUT',
        body: { enabled: input.enabled, ...(input.note ? { note: input.note } : {}) },
        schema: unofficialWorkspaceSchema,
      }),
    onSuccess: async (_row, input) => {
      toast.success(
        t(input.enabled ? 'addedToast' : 'removedToast', {
          name: (input.enabled ? adding?.name : removing?.name) ?? '',
        }),
      );
      closeAll();
      if (input.enabled) setTyped('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: NODE_BRIDGE_QUERY_KEY, exact: true }),
      ]);
      // The console menu badge is drawn by the server layout.
      router.refresh();
    },
    onError: (err) => toast.error(t(`errors.${errorKind(err)}`)),
  });

  // An operator without permission to read the list does not see the panel.
  if (list.error instanceof ApiError && list.error.status === 403) return null;

  const banner = panelBanner(platformOn, workspaceCount);
  const noteCheck = checkNote(note);

  return (
    <Card className="space-y-4" data-testid="workspaces-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <Badge tone={workspaceCount > 0 ? 'success' : 'neutral'} data-testid="workspaces-count">
          {t('count', { count: workspaceCount })}
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>

      {banner === 'engineOff' && (
        <Alert tone="warning" data-testid="workspaces-engine-off">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{t('engineOff')}</p>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const el = document.getElementById(UNOFFICIAL_TOGGLE_ID);
                  el?.scrollIntoView({ block: 'center' });
                  el?.focus();
                }}
              >
                {t('engineOffAction')}
              </Button>
            )}
          </div>
        </Alert>
      )}

      {canEdit ? (
        <div className="space-y-2" data-testid="workspaces-search">
          <Field label={t('search.label')} htmlFor={searchId} hint={t('search.hint')}>
            <Input
              id={searchId}
              type="search"
              value={typed}
              autoComplete="off"
              placeholder={t('search.placeholder')}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          {ready && options.isFetching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner /> {t('search.searching')}
            </p>
          )}
          {ready && options.isError && (
            <Alert tone="danger">
              <p>{t(`errors.${errorKind(options.error)}`)}</p>
            </Alert>
          )}
          {ready && options.isSuccess && !options.isFetching && found.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="workspaces-search-none">
              {t('search.none', { q: term })}
            </p>
          )}
          {ready && found.length > 0 && (
            <OptionList
              options={found}
              busy={change.isPending}
              onAdd={(o) => {
                setNote('');
                setAdding(o);
              }}
            />
          )}
        </div>
      ) : (
        <Alert tone="info" data-testid="workspaces-read-only">
          {t('readOnly')}
        </Alert>
      )}

      {list.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> {t('loadingMore')}
        </div>
      ) : list.isError ? (
        <Alert tone="danger" role="alert">
          <p>{t(`errors.${errorKind(list.error)}`)}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void list.refetch()}
          >
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <WorkspaceTable
            rows={rows}
            busy={change.isPending}
            {...(canEdit ? { onRemove: (r: WorkspaceRow) => setRemoving(r) } : {})}
          />
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                data-testid="workspaces-load-more"
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <Modal
        open={adding !== null}
        onClose={() => {
          if (!change.isPending) closeAll();
        }}
        title={t('addDialog.title', { name: adding?.name ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={closeAll} disabled={change.isPending}>
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!noteCheck.ok || change.isPending || adding === null}
              onClick={() => {
                if (adding && noteCheck.ok) {
                  change.mutate({ orgUuid: adding.orgUuid, enabled: true, note: noteCheck.value });
                }
              }}
              data-testid="workspace-add-confirm"
            >
              {change.isPending && <Spinner />}
              {t('addDialog.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t('addDialog.body', { name: adding?.name ?? '', slug: adding?.slug ?? '' })}
          </p>
          <Field
            label={t('addDialog.noteLabel')}
            htmlFor={noteId}
            hint={t('addDialog.noteCount', { count: note.trim().length, max: NOTE_MAX })}
            error={noteCheck.ok ? undefined : t('addDialog.noteTooLong', { max: NOTE_MAX })}
          >
            <Textarea
              id={noteId}
              rows={3}
              value={note}
              invalid={!noteCheck.ok}
              placeholder={t('addDialog.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={t('removeDialog.title', { name: removing?.name ?? '' })}
        message={t('removeDialog.body', { name: removing?.name ?? '' })}
        confirmLabel={t('removeDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={change.isPending}
        onConfirm={() => {
          if (removing) change.mutate({ orgUuid: removing.orgUuid, enabled: false });
        }}
        onClose={closeAll}
      />
    </Card>
  );
}
