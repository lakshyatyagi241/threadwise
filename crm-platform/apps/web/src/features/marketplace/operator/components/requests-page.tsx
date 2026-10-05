'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  MARKET_APP_KINDS,
  MARKET_REQUEST_STATUSES,
  type MarketOperatorRequest,
  type MarketRequestStatus,
} from '@crm/contracts';
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { fetchRequests, marketKeys, updateRequest } from '../api';
import { REQUEST_NOTE_MAX } from '../lib/confirmations';
import { isConflict } from '../lib/errors';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';
import {
  noteTooLong,
  safeWebsite,
  triageDraft,
  triagePatch,
  type TriageDraft,
} from '../lib/requests';
import { useDebounced } from './use-docs-check';
import {
  ErrorLine,
  Failure,
  KindLabel,
  LoadingBlock,
  MarketGate,
  RequestStatusBadge,
  textLink,
} from './ui';

const NS = 'marketplace.operator.requests';

/** Operator console: the demand report (what workspaces asked for, most voted first). Needs either Marketplace key; only manage triages. */
export function RequestsPage() {
  return <MarketGate>{(access) => <Requests access={access} />}</MarketGate>;
}

function Requests({ access }: { access: MarketAccess }) {
  const t = useTranslations(NS);
  const te = useTranslations('marketplace.operator.enums');
  const [status, setStatus] = useState<MarketRequestStatus | 'all'>('all');
  const [kind, setKind] = useState<'mini_app' | 'integration' | 'all'>('all');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const wire = {
    ...(status !== 'all' ? { status } : {}),
    ...(kind !== 'all' ? { kind } : {}),
    ...(debounced.trim() ? { q: debounced.trim().slice(0, 80) } : {}),
  };
  const [triaging, setTriaging] = useState<MarketOperatorRequest | null>(null);

  const q = useInfiniteQuery({
    queryKey: marketKeys.requests(wire),
    queryFn: ({ pageParam, signal }) => fetchRequests({ ...wire, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    // Changing a filter keeps the list on screen (and the filter box focused) while the new one loads.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const filtered = status !== 'all' || kind !== 'all' || search.trim() !== '';

  const header = <PageHeader title={t('title')} description={t('description')} />;

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError && !q.data) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {!access.manage && <Alert>{t('readOnly', { permission: MARKET_PERMISSIONS.manage })}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3" role="search" aria-label={t('filters.label')}>
        <Field label={t('filters.search')} htmlFor="requests-search">
          <Input
            id="requests-search"
            type="search"
            placeholder={t('filters.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field label={t('filters.kind')} htmlFor="requests-kind">
          <Select
            id="requests-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="all">{t('filters.allKinds')}</option>
            {MARKET_APP_KINDS.map((k) => (
              <option key={k} value={k}>
                {te(`kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.status')} htmlFor="requests-status">
          <Select
            id="requests-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">{t('filters.allStatuses')}</option>
            {MARKET_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(`requestStatus.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {q.isError && <Failure error={q.error} onRetry={() => void q.refetch()} />}

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('noMatchTitle') : t('emptyTitle')}
          message={filtered ? t('noMatchMessage') : t('emptyMessage')}
          actions={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setStatus('all');
                  setKind('all');
                  setSearch('');
                }}
              >
                {t('clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <RequestsTable rows={rows} canTriage={access.manage} onTriage={setTriaging} />
      )}

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

      {triaging && <TriageDialog request={triaging} onClose={() => setTriaging(null)} />}
    </div>
  );
}

export function RequestsTable({
  rows,
  canTriage,
  onTriage,
}: {
  rows: readonly MarketOperatorRequest[];
  canTriage: boolean;
  onTriage: (r: MarketOperatorRequest) => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.votes')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.request')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.notes')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.firstWorkspace')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            {canTriage && (
              <th scope="col" className="px-3 py-2 text-end font-medium">
                <span className="sr-only">{t('cols.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const link = safeWebsite(r.website);
            return (
              <tr key={r.id} data-testid={`request-${r.id}`}>
                <td className="px-3 py-3 text-end align-top">
                  <span aria-hidden="true" className="text-2xl font-semibold tabular-nums">
                    {r.voteCount}
                  </span>
                  <span className="sr-only">{t('votes', { count: r.voteCount })}</span>
                </td>
                <th scope="row" className="px-3 py-3 text-start align-top font-normal">
                  <div className="font-medium" dir="auto">
                    {r.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <KindLabel kind={r.kind} />
                    {r.categorySlug && (
                      <code className="font-mono" dir="ltr">
                        {r.categorySlug}
                      </code>
                    )}
                    <time dateTime={r.createdAt}>
                      {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
                    </time>
                  </div>
                  {r.website &&
                    (link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${textLink} mt-1 inline-block break-all text-xs`}
                        dir="ltr"
                      >
                        {r.website}
                      </a>
                    ) : (
                      <span
                        className="mt-1 block break-all text-xs text-muted-foreground"
                        dir="ltr"
                      >
                        {r.website}
                      </span>
                    ))}
                </th>
                <td className="max-w-sm px-3 py-3 align-top">
                  {r.notes.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t('noNotes')}</span>
                  ) : (
                    <ul className="list-disc space-y-1 ps-4 text-xs" dir="auto">
                      {r.notes.slice(0, 5).map((n, i) => (
                        <li key={i} className="break-words">
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-xs" dir="auto">
                  {r.firstWorkspace?.name ?? (
                    <span className="text-muted-foreground">{t('dash')}</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  <RequestStatusBadge status={r.status} />
                  {r.operatorNote && (
                    <div className="mt-1 max-w-xs text-xs text-muted-foreground" dir="auto">
                      {t('operatorNote', { note: r.operatorNote })}
                    </div>
                  )}
                </td>
                {canTriage && (
                  <td className="px-3 py-3 text-end align-top">
                    <Button variant="secondary" size="sm" onClick={() => onTriage(r)}>
                      {t('triageAction')}
                      <span className="sr-only"> {r.name}</span>
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Triage one request: a status and an operator note, saved with the version the operator read (a 409 says reload, never a retry). */
export function TriageDialog({
  request,
  onClose,
}: {
  request: MarketOperatorRequest;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.triage`);
  const te = useTranslations('marketplace.operator.enums.requestStatus');
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TriageDraft>(triageDraft(request));
  const patch = triagePatch(request, draft);
  const tooLong = noteTooLong(draft.note);
  const formId = 'triage-form';

  const reload = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.requestsAll });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => updateRequest(request.id, patch!),
    onSuccess: () => {
      toast.success(t('saved', { name: request.name }));
      reload();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (patch && !tooLong) save.mutate();
  };

  return (
    <Modal
      open
      title={t('title', { name: request.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={!patch || tooLong || save.isPending}>
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {isConflict(save.error) ? (
          <Alert tone="warning" className="space-y-2">
            <p>{t('conflict')}</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              {t('reload')}
            </Button>
          </Alert>
        ) : (
          save.error && <ErrorLine error={save.error} />
        )}
        <p className="text-sm text-muted-foreground">{t('votes', { count: request.voteCount })}</p>
        <Field label={t('status')} htmlFor="triage-status">
          <Select
            id="triage-status"
            value={draft.status}
            disabled={save.isPending}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as MarketRequestStatus })}
          >
            {MARKET_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('note')}
          htmlFor="triage-note"
          hint={t('noteHint', { max: REQUEST_NOTE_MAX })}
          error={tooLong ? t('noteTooLong', { max: REQUEST_NOTE_MAX }) : undefined}
        >
          <Textarea
            id="triage-note"
            rows={3}
            value={draft.note}
            disabled={save.isPending}
            invalid={tooLong}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
