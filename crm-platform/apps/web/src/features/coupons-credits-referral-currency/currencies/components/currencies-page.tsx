'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCY_LIMITS, type CurrencyItem } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Input, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { CURRENCY_KEYS, currencyApi } from '../api';
import { errorKind, inUseBy, ratesFailureDetail, requestIdOf } from '../lib/errors';
import {
  checkCreate,
  checkEdit,
  submitError,
  type CurrencyDraft,
  type CurrencyProblems,
} from '../lib/form';
import {
  currentCursor,
  firstPage,
  goNext,
  goPrevious,
  hasPrevious,
  showingRange,
  toggleTarget,
  type PageStack,
} from '../lib/table';
import {
  AddCurrencyForm,
  CurrencyKpis,
  CurrencyTable,
  DefaultCurrencyCard,
  EditCurrencyForm,
} from './currency-parts';

const NS = 'coupons-credits-referral-currency.currencies.admin';

interface Flash {
  tone: 'success' | 'danger';
  text: string;
}

/** Writes are for super admins (the API enforces it); every other operator role reads. */
export function useCanWriteCurrencies(): boolean {
  return useOperator().canRunDanger;
}

/** "Platform currencies": the catalog, the system default, live rates, add / edit / switch / delete. */
export function CurrenciesPage() {
  const t = useTranslations(NS);
  const tErr = useTranslations(`${NS}.errors`);
  const canWrite = useCanWriteCurrencies();
  const { operator } = useOperator();
  const qc = useQueryClient();

  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<PageStack>(firstPage);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProblems, setAddProblems] = useState<CurrencyProblems>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProblems, setEditProblems] = useState<CurrencyProblems>({});
  const [stale, setStale] = useState(false);
  const [deleting, setDeleting] = useState<CurrencyItem | null>(null);

  const cursor = currentCursor(pages);
  const list = useQuery({
    queryKey: CURRENCY_KEYS.list(q, cursor),
    queryFn: ({ signal }) =>
      currencyApi.list({ q, cursor, limit: CURRENCY_LIMITS.pageSize }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const data = list.data;

  const refresh = () => void qc.invalidateQueries({ queryKey: CURRENCY_KEYS.all });
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    const text =
      kind === 'ratesFailed'
        ? tErr('ratesFailed', { detail: ratesFailureDetail(err) })
        : kind === 'inUse'
          ? inUseBy(err).length > 0
            ? tErr('inUse', { code: deleting?.code ?? '', used: inUseBy(err).join(', ') })
            : tErr('inUseUnknown')
          : tErr(kind);
    setFlash({ tone: 'danger', text });
  };
  const ok = (text: string) => setFlash({ tone: 'success', text });

  const fetchRates = useMutation({
    mutationFn: () => currencyApi.fetchRates(),
    onMutate: () => setFlash(null),
    onSuccess: (r) => {
      refresh();
      ok(t('ratesUpdated', { count: r.updated, provider: r.provider }));
    },
    onError: fail,
  });
  const setDefault = useMutation({
    mutationFn: (code: string) => currencyApi.setDefault(code),
    onMutate: () => setFlash(null),
    onSuccess: (_r, code) => {
      refresh();
      ok(t('default.saved', { code: code.toUpperCase() }));
    },
    onError: fail,
  });
  const create = useMutation({
    mutationFn: (body: Parameters<typeof currencyApi.create>[0]) => currencyApi.create(body),
    onMutate: () => setFlash(null),
    onSuccess: () => {
      setAdding(false);
      setAddProblems({});
      setPages(firstPage);
      refresh();
      ok(t('form.added'));
    },
    onError: (err) => {
      const e = submitError(err);
      if (e.kind === 'fields') setAddProblems(e.problems);
      else fail(err);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof currencyApi.update>[1] }) =>
      currencyApi.update(v.id, v.body),
    onMutate: () => setFlash(null),
    onSuccess: () => {
      setEditingId(null);
      setEditProblems({});
      setStale(false);
      refresh();
      ok(t('editing.saved'));
    },
    onError: (err) => {
      const e = submitError(err);
      if (e.kind === 'stale') {
        setStale(true);
        refresh();
      } else if (e.kind === 'fields') setEditProblems(e.problems);
      else fail(err);
    },
  });
  const toggle = useMutation({
    mutationFn: (c: CurrencyItem) => currencyApi.setActive(c.id, toggleTarget(c)),
    onMutate: () => setFlash(null),
    onSuccess: (c) => {
      refresh();
      ok(t(c.isActive ? 'activated' : 'deactivated'));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (c: CurrencyItem) => currencyApi.remove(c.id),
    onMutate: () => setFlash(null),
    onSuccess: () => {
      setDeleting(null);
      // The last row of a later page is gone: step back rather than show an empty page over earlier rows.
      if ((data?.data.length ?? 0) <= 1 && hasPrevious(pages)) setPages(goPrevious);
      refresh();
      ok(t('removed'));
    },
    onError: (err) => {
      fail(err);
      setDeleting(null);
    },
  });

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(searchText.trim());
    setPages(firstPage);
  };
  const submitAdd = (draft: CurrencyDraft) => {
    const check = checkCreate(draft);
    if (!check.ok) return setAddProblems(check.problems);
    setAddProblems({});
    create.mutate(check.body);
  };
  const submitEdit = (item: CurrencyItem, draft: CurrencyDraft) => {
    const check = checkEdit(draft, item.rowVersion);
    if (!check.ok) return setEditProblems(check.problems);
    setEditProblems({});
    update.mutate({ id: item.id, body: check.body });
  };

  const range = data
    ? showingRange(pages, CURRENCY_LIMITS.pageSize, data.data.length, data.total)
    : null;

  return (
    <div className="space-y-5">
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/admin" className="hover:underline">
              {t('admin')}
            </Link>
          </li>
          <li aria-hidden="true">&gt;</li>
          <li aria-current="page" className="text-foreground">
            {t('crumb')}
          </li>
        </ol>
      </nav>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite ? (
            <>
              <Button
                variant="secondary"
                disabled={fetchRates.isPending}
                onClick={() => fetchRates.mutate()}
              >
                {fetchRates.isPending ? t('fetchingRates') : t('fetchRates')}
              </Button>
              <Button
                aria-expanded={adding}
                onClick={() => {
                  setAdding((v) => !v);
                  setAddProblems({});
                }}
              >
                {t('addCurrency')}
              </Button>
            </>
          ) : undefined
        }
      />
      {!canWrite && (
        <Alert tone="info">{t('readOnly', { role: operator.role.replace(/_/g, ' ') })}</Alert>
      )}
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}

      {list.isPending ? (
        <div
          role="status"
          className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner label={t('loading')} />
          {t('loading')}
        </div>
      ) : list.isError || !data ? (
        <Alert tone="danger" className="space-y-2">
          <p>{tErr(errorKind(list.error))}</p>
          {requestIdOf(list.error) && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{requestIdOf(list.error)}</span>
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <CurrencyKpis stats={data.stats} />
          <DefaultCurrencyCard
            key={data.stats.defaultCode}
            options={data.activeOptions}
            defaultCode={data.stats.defaultCode}
            canWrite={canWrite}
            busy={setDefault.isPending}
            onSet={(code) => setDefault.mutate(code)}
          />
          {canWrite && adding && (
            <AddCurrencyForm
              busy={create.isPending}
              problems={addProblems}
              onSubmit={submitAdd}
              onCancel={() => {
                setAdding(false);
                setAddProblems({});
              }}
            />
          )}
          <Card className="space-y-4 p-0">
            <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('catalog.eyebrow')}
                </p>
                <h2 className="text-lg font-semibold">{t('catalog.title')}</h2>
              </div>
              <form role="search" onSubmit={submitSearch} className="w-full sm:w-72">
                <Input
                  type="search"
                  aria-label={t('catalog.searchLabel')}
                  placeholder={t('catalog.searchPlaceholder')}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </form>
            </div>
            <CurrencyTable
              rows={data.data}
              q={q}
              canWrite={canWrite}
              busyId={toggle.isPending ? (toggle.variables?.id ?? null) : null}
              editingId={editingId}
              onToggle={(c) => toggle.mutate(c)}
              onEdit={(c) => {
                setEditingId(c.id);
                setEditProblems({});
                setStale(false);
              }}
              onDelete={(c) => setDeleting(c)}
              renderEditor={(item) => (
                <EditCurrencyForm
                  key={`${item.id}:${item.rowVersion}`}
                  item={item}
                  busy={update.isPending}
                  problems={editProblems}
                  stale={stale}
                  onSubmit={(draft) => submitEdit(item, draft)}
                  onCancel={() => {
                    setEditingId(null);
                    setEditProblems({});
                    setStale(false);
                  }}
                />
              )}
            />
            {range && (
              <nav
                aria-label={t('pagination.label')}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm"
              >
                <span className="text-muted-foreground">
                  {t('pagination.showing', { from: range.from, to: range.to, total: range.total })}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!hasPrevious(pages) || list.isFetching}
                    onClick={() => setPages(goPrevious)}
                  >
                    {t('pagination.prev')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!data.page.hasMore || list.isFetching}
                    onClick={() => setPages((p) => goNext(p, data.page.nextCursor))}
                  >
                    {t('pagination.next')}
                  </Button>
                </span>
              </nav>
            )}
          </Card>
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle')}
        message={t('deleteBody', { code: deleting?.code ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('deleteCancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
