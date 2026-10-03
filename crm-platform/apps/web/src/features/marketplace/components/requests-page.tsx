'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import {
  MARKET_APP_KINDS,
  MARKET_REQUEST_STATUSES,
  marketRequestSchema,
  type MarketAppKind,
  type MarketRequest,
  type MarketRequestResult,
  type MarketRequestStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { askForApp, fetchCategories, mktKeys, unvoteRequest, voteForRequest } from '../api';
import { mktError } from '../lib/errors';
import {
  REQUEST_NOTE_MAX,
  REQUEST_NAME_MAX,
  REQUEST_SORTS,
  REQUEST_STATUS_TONE,
  askOutcome,
  emptyRequestDraft,
  replaceRequest,
  toRequestBody,
  validateRequest,
  withVote,
  type RequestDraft,
  type RequestField,
  type RequestProblem,
  type RequestSort,
} from '../lib/requests';
import { ThumbIcon } from './icons';
import { MarketplaceHeader } from './marketplace-header';
import { ErrorLine, ErrorPanel, LoadingBlock, PAGE, Section } from './ui';
import { useAsyncAction } from './use-async-action';

/** Ask for an integration or mini app that is not listed, and see (and vote for) what other workspaces asked for. */
export function RequestsPage() {
  const t = useTranslations('marketplace.requests');
  const params = useSearchParams();
  const kindParam = params.get('kind');
  const initialKind: MarketAppKind = (MARKET_APP_KINDS as readonly string[]).includes(
    kindParam ?? '',
  )
    ? (kindParam as MarketAppKind)
    : 'integration';
  const initialName = (params.get('name') ?? '').trim().slice(0, REQUEST_NAME_MAX);
  return (
    <div className={PAGE}>
      <MarketplaceHeader section="requests" />
      <h2 className="sr-only">{t('title')}</h2>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <RequestForm initialKind={initialKind} initialName={initialName} />
        <RequestList />
      </div>
    </div>
  );
}

function RequestForm({
  initialKind,
  initialName,
}: {
  initialKind: MarketAppKind;
  initialName: string;
}) {
  const t = useTranslations('marketplace.requests.form');
  const qc = useQueryClient();
  const action = useAsyncAction();
  const [draft, setDraft] = useState<RequestDraft>({
    ...emptyRequestDraft(initialKind),
    name: initialName,
  });
  const [problems, setProblems] = useState<Partial<Record<RequestField, RequestProblem>>>({});
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MarketRequestResult | null>(null);

  const categories = useQuery({
    queryKey: mktKeys.categories(draft.kind),
    queryFn: ({ signal }) => fetchCategories(draft.kind, signal),
    staleTime: 60_000,
  });

  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => ({ ...p, [key]: undefined }));
    setServerFields((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key)));
  };

  const submit = async () => {
    setResult(null);
    setServerFields({});
    const found = validateRequest(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const out = await action.run(() => askForApp(toRequestBody(draft)));
    if (!out.ok) {
      const view = mktError(out.error);
      setServerFields(view.fields);
      return;
    }
    setResult(out.value);
    setDraft(emptyRequestDraft(draft.kind));
    void qc.invalidateQueries({ queryKey: mktKeys.requests });
  };

  const err = (field: RequestField) =>
    problems[field]
      ? t(`problems.${problems[field]}`)
      : serverFields[field]
        ? t('problems.server')
        : undefined;
  const failure = action.error;
  const failureView = failure ? mktError(failure) : null;

  return (
    <Section title={t('title')} description={t('intro')}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <Field label={t('name')} htmlFor="mkt-req-name" error={err('name')}>
          <Input
            id="mkt-req-name"
            value={draft.name}
            maxLength={REQUEST_NAME_MAX}
            onChange={(e) => set('name', e.target.value)}
            invalid={Boolean(err('name'))}
            placeholder={t('namePlaceholder')}
            autoComplete="off"
            required
          />
        </Field>
        <Field label={t('kind')} htmlFor="mkt-req-kind">
          <Select
            id="mkt-req-kind"
            value={draft.kind}
            onChange={(e) => {
              set('kind', e.target.value as MarketAppKind);
              set('categorySlug', '');
            }}
          >
            {MARKET_APP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('category')} htmlFor="mkt-req-category" hint={t('categoryHint')}>
          <Select
            id="mkt-req-category"
            value={draft.categorySlug}
            onChange={(e) => set('categorySlug', e.target.value)}
          >
            <option value="">{t('anyCategory')}</option>
            {(categories.data?.data ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('website')}
          htmlFor="mkt-req-website"
          hint={t('websiteHint')}
          error={err('website')}
        >
          <Input
            id="mkt-req-website"
            type="url"
            inputMode="url"
            dir="ltr"
            value={draft.website}
            onChange={(e) => set('website', e.target.value)}
            invalid={Boolean(err('website'))}
            placeholder="https://"
            autoComplete="off"
          />
        </Field>
        <Field
          label={t('note')}
          htmlFor="mkt-req-note"
          hint={`${t('noteHint')} (${draft.note.length}/${REQUEST_NOTE_MAX})`}
          error={err('note')}
        >
          <Textarea
            id="mkt-req-note"
            value={draft.note}
            maxLength={REQUEST_NOTE_MAX}
            onChange={(e) => set('note', e.target.value)}
            invalid={Boolean(err('note'))}
          />
        </Field>

        {failure && Object.keys(failureView?.fields ?? {}).length === 0 ? (
          <ErrorLine error={failure} />
        ) : null}
        <div aria-live="polite">{result && <AskResult result={result} />}</div>
        <div className="flex justify-end">
          <Button type="submit" disabled={action.pending}>
            {action.pending && <Spinner />}
            {t('submit')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** The answer to asking. `created: false` means somebody already asked and this ask was counted as a vote: said apart from a new request. */
export function AskResult({ result }: { result: MarketRequestResult }) {
  const t = useTranslations('marketplace.requests.form');
  return (
    <Alert tone={result.created ? 'success' : 'info'} data-testid="ask-result">
      <p className="font-medium">
        {t(`result.${askOutcome(result)}.title`, { name: result.request.name })}
      </p>
      <p>{t(`result.${askOutcome(result)}.message`)}</p>
    </Alert>
  );
}

const useDebounced = (value: string, ms: number) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
};

function RequestList() {
  const t = useTranslations('marketplace.requests.list');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<MarketAppKind | 'all'>('all');
  const [status, setStatus] = useState<MarketRequestStatus | 'all'>('all');
  const [sort, setSort] = useState<RequestSort>('votes');
  const q = useDebounced(search.trim(), 300);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [voteError, setVoteError] = useState<unknown>(null);

  const list = useCursorList(mktKeys.requests, '/marketplace/requests', marketRequestSchema, {
    q: q || undefined,
    kind: kind === 'all' ? undefined : kind,
    status: status === 'all' ? undefined : status,
    sort,
    limit: 25,
  });

  type Pages = { pages: Array<{ data: MarketRequest[] }>; pageParams: unknown[] };
  const patch = (next: MarketRequest) =>
    qc.setQueriesData<Pages>({ queryKey: mktKeys.requests }, (old) =>
      old ? { ...old, pages: replaceRequest(old.pages, next) } : old,
    );

  /** Optimistic: the count and the toggle change at once; a failed call puts every cached list back as it was. */
  const vote = async (r: MarketRequest, want: boolean) => {
    if (busy.has(r.id)) return;
    setBusy((s) => new Set(s).add(r.id));
    setVoteError(null);
    const before = qc.getQueriesData<Pages>({ queryKey: mktKeys.requests });
    patch(withVote(r, want));
    try {
      const server = await (want ? voteForRequest(r.id) : unvoteRequest(r.id));
      patch(server);
    } catch (e) {
      for (const [key, data] of before) qc.setQueryData(key, data);
      setVoteError(e);
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(r.id);
        return next;
      });
    }
  };

  const filtered = q !== '' || kind !== 'all' || status !== 'all';
  return (
    <Section title={t('title')} description={t('intro')}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor="mkt-req-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <Input
            id="mkt-req-search"
            type="search"
            value={search}
            maxLength={80}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label={t('kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as MarketAppKind | 'all')}
          className="w-auto"
        >
          <option value="all">{t('allKinds')}</option>
          {MARKET_APP_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as MarketRequestStatus | 'all')}
          className="w-auto"
        >
          <option value="all">{t('allStatuses')}</option>
          {MARKET_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('sort')}
          value={sort}
          onChange={(e) => setSort(e.target.value as RequestSort)}
          className="w-auto"
        >
          {REQUEST_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sorts.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {voteError ? <ErrorLine error={voteError} /> : null}

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={filtered ? t('emptyFiltered.title') : t('empty.title')}
          message={filtered ? t('emptyFiltered.message') : t('empty.message')}
        />
      ) : (
        <>
          <ul
            className="divide-y divide-border rounded-md border border-border"
            data-testid="requests"
          >
            {list.items.map((r) => (
              <RequestRow key={r.id} request={r} busy={busy.has(r.id)} onVote={vote} />
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function RequestRow({
  request: r,
  busy,
  onVote,
}: {
  request: MarketRequest;
  busy: boolean;
  onVote: (r: MarketRequest, want: boolean) => void;
}) {
  const t = useTranslations('marketplace.requests.list');
  const f = useFormatter();
  return (
    <li data-testid={`request-${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">{r.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge tone="neutral">{t(`kinds.${r.kind}`)}</Badge>
          <Badge tone={REQUEST_STATUS_TONE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
          <span>{f.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}</span>
        </p>
      </div>
      <p className="text-sm tabular-nums" aria-live="polite">
        {t('votes', { count: r.voteCount })}
      </p>
      <Button
        variant={r.hasVoted ? 'primary' : 'secondary'}
        size="sm"
        aria-pressed={r.hasVoted}
        disabled={busy}
        onClick={() => onVote(r, !r.hasVoted)}
      >
        <ThumbIcon />
        {r.hasVoted ? t('voted') : t('vote')}
        <span className="sr-only"> — {r.name}</span>
      </Button>
    </li>
  );
}
