'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrencyItem, CurrencyListResponse } from '@crm/contracts';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  Spinner,
  StatTile,
  ToastProvider,
  cn,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import {
  KEYS,
  currencyItemSchema,
  fetchCurrencies,
  fetchRatesResponseSchema,
  setDefaultCurrencyResponseSchema,
} from '../api';
import {
  buildCurrencyRequest,
  currencyToDraft,
  newCurrencyDraft,
  type CurrencyDraft,
  type CurrencyField,
} from '../lib/currency-draft';
import { cpnErrorKey, usedByList } from '../lib/errors';
import { Accent, ErrorBlock, LoadingBlock, PageHead, Pager, Problems } from './ui';

const NS = 'coupons-credits-referral-currency.currencies';
/** The API's limit on the search text. */
const MAX_SEARCH = 100;
/** Form fields in their on-screen order, and the id fragment each input carries. */
const FIELD_ORDER: readonly CurrencyField[] = [
  'name',
  'code',
  'symbol',
  'precision',
  'exchangeRate',
];
const FIELD_ID: Record<CurrencyField, string> = {
  name: 'name',
  code: 'code',
  symbol: 'symbol',
  precision: 'precision',
  exchangeRate: 'rate',
};
const LBL = 'mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';

export function CurrenciesPage() {
  const t = useTranslations('coupons-credits-referral-currency.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <CurrenciesScreen />
    </ToastProvider>
  );
}

function CurrenciesScreen() {
  const sp = useSearchParams();
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  // A search longer than the API accepts cannot match anything: it is never sent.
  const tooLong = q.length > MAX_SEARCH;
  const apiQ = tooLong ? undefined : q || undefined;
  const apiPage = tooLong ? 1 : page;
  const query = useQuery({
    queryKey: KEYS.currencyList({ q: apiQ, page: apiPage }),
    queryFn: ({ signal }) => fetchCurrencies({ q: apiQ, page: apiPage }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isPending) return <Catalogue q={q} notice={<LoadingBlock />} />;
  if (query.isError) {
    return (
      <Catalogue
        q={q}
        notice={<ErrorBlock error={query.error} onRetry={() => void query.refetch()} />}
      />
    );
  }
  const data: CurrencyListResponse = tooLong
    ? { ...query.data, data: [], total: 0, pageCount: 0, from: 0, to: 0, page: 1 }
    : query.data;
  return <Catalogue data={data} q={q} />;
}

/** `data` is absent while the list loads or failed: the frame, the search box and `notice` still show. */
function Catalogue({
  data,
  q,
  notice,
}: {
  data?: CurrencyListResponse;
  q: string;
  notice?: ReactNode;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CurrencyItem | null>(null);
  const [deleting, setDeleting] = useState<CurrencyItem | null>(null);
  const [defaultPick, setDefaultPick] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.currencies });

  const failure = (e: unknown) => {
    const key = cpnErrorKey(e);
    toast(te(key, { used: usedByList(e) }), 'danger');
    void refresh();
  };

  const go = (next: { q?: string; page?: number }) => {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    if (nq) p.set('q', nq);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    const s = p.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };

  const fetchRates = useMutation({
    mutationFn: () =>
      operatorFetch('/currencies/fetch-rates', {
        method: 'POST',
        body: {},
        schema: fetchRatesResponseSchema,
      }),
    onSuccess: (r) => {
      toast(t('toasts.ratesUpdated', { count: r.updated, provider: r.provider }));
      return refresh();
    },
    onError: failure,
  });

  const setDefault = useMutation({
    mutationFn: (code: string) =>
      operatorFetch('/currencies/default', {
        method: 'POST',
        body: { code },
        schema: setDefaultCurrencyResponseSchema,
      }),
    onSuccess: (r) => {
      toast(t('toasts.defaultSet', { code: r.defaultCode }));
      return refresh();
    },
    onError: failure,
  });

  const toggle = useMutation({
    mutationFn: (c: CurrencyItem) =>
      operatorFetch(`/currencies/${c.id}/active`, {
        method: 'PATCH',
        body: { isActive: !c.isActive },
        schema: currencyItemSchema,
      }),
    onSuccess: (c) => {
      toast(t(c.isActive ? 'toasts.activated' : 'toasts.deactivated'));
      return refresh();
    },
    onError: failure,
  });

  const remove = useMutation({
    mutationFn: (c: CurrencyItem) => operatorFetch(`/currencies/${c.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(t('toasts.deleted'));
      setDeleting(null);
      await refresh();
    },
  });

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get('q');
    go({ q: typeof value === 'string' ? value.trim() : '', page: 1 });
  };

  const nf = new Intl.NumberFormat(locale);
  const rate = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const th = 'px-4 py-2.5 font-medium';

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[{ label: tc('admin'), href: '/admin' }, { label: t('crumbHere') }]}
        eyebrow={t('eyebrow')}
        title={
          <>
            {t('titleLead')} <Accent>{t('titleAccent')}</Accent>
          </>
        }
        description={t('description')}
        actions={
          canEdit && (
            <>
              <Button
                variant="secondary"
                className="h-9 rounded-full px-3.5 text-xs"
                disabled={fetchRates.isPending}
                onClick={() => fetchRates.mutate()}
              >
                {fetchRates.isPending ? (
                  <Spinner />
                ) : (
                  <svg
                    viewBox="0 0 16 16"
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="M14 8a6 6 0 1 1-1.76-4.24" />
                    <path d="M14 2v3.5h-3.5" />
                  </svg>
                )}
                {fetchRates.isPending ? t('fetching') : t('fetchRates')}
              </Button>
              <Button
                className="h-9 rounded-full px-3.5 text-xs"
                aria-expanded={adding}
                onClick={() => setAdding((v) => !v)}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
                {t('add')}
              </Button>
            </>
          )
        }
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      {data && (
        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label={t('crumbHere')}
        >
          <StatTile
            label={t('kpi.total')}
            value={<span className="font-serif font-normal">{nf.format(data.summary.total)}</span>}
            hint={t('kpi.totalHint')}
            className="rounded-2xl"
          />
          <StatTile
            tone="accent"
            label={t('kpi.active')}
            value={<span className="font-serif font-normal">{nf.format(data.summary.active)}</span>}
            hint={t('kpi.activeHint')}
            className="rounded-2xl"
          />
          <StatTile
            label={t('kpi.default')}
            value={
              <span className="font-serif font-normal uppercase">{data.summary.defaultCode}</span>
            }
            hint={t('kpi.defaultHint')}
            className="rounded-2xl"
          />
          <StatTile
            label={t('kpi.inactive')}
            value={
              <span className="font-serif font-normal">{nf.format(data.summary.inactive)}</span>
            }
            hint={t('kpi.inactiveHint')}
            className="rounded-2xl"
          />
        </section>
      )}

      {data && (
        <Card className="overflow-hidden rounded-2xl p-0">
          <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('defaultCard.eyebrow')}
              </div>
              <h2 className="mt-0.5 font-serif text-xl leading-tight">{t('defaultCard.title')}</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                {t('defaultCard.body')}
              </p>
            </div>
            {canEdit && (
              <form
                className="flex shrink-0 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDefault.mutate(defaultPick ?? data.summary.defaultCode);
                }}
              >
                <Select
                  aria-label={t('defaultCard.select')}
                  value={defaultPick ?? data.summary.defaultCode}
                  onChange={(e) => setDefaultPick(e.target.value)}
                  className="h-auto w-auto py-2 font-mono text-[12.5px]"
                >
                  {data.defaultChoices.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name} {c.symbol ? `(${c.symbol})` : ''}
                    </option>
                  ))}
                </Select>
                <Button
                  type="submit"
                  className="h-9 rounded-full px-4 text-xs"
                  disabled={setDefault.isPending}
                >
                  {setDefault.isPending ? t('defaultCard.setting') : t('defaultCard.set')}
                </Button>
              </form>
            )}
          </div>
        </Card>
      )}

      {adding && canEdit && (
        <CurrencyForm
          mode="add"
          onClose={() => setAdding(false)}
          onSaved={async () => {
            toast(t('toasts.added'));
            setAdding(false);
            await refresh();
          }}
        />
      )}

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('catalog.eyebrow')}
            </div>
            <h2 className="mt-1 font-serif text-[22px] leading-tight">{t('catalog.title')}</h2>
          </div>
          <form onSubmit={onSearch} role="search" className="relative w-full sm:w-[280px]">
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="m11 11 3 3" />
            </svg>
            <input
              key={q}
              type="search"
              name="q"
              defaultValue={q}
              aria-label={t('searchLabel')}
              placeholder={t('search')}
              className="w-full rounded-full border border-border bg-muted py-1.5 ps-9 pe-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
        </div>
        {data ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <caption className="sr-only">{t('table.label')}</caption>
                <thead className="bg-muted font-mono text-[10.5px] uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className={cn(th, 'w-[110px] text-start')}>
                      {t('table.code')}
                    </th>
                    <th scope="col" className={cn(th, 'text-start')}>
                      {t('table.name')}
                    </th>
                    <th scope="col" className={cn(th, 'w-[70px] text-start')}>
                      {t('table.symbol')}
                    </th>
                    <th scope="col" className={cn(th, 'w-[150px] text-end')}>
                      {t('table.rate')}
                    </th>
                    <th scope="col" className={cn(th, 'w-[80px] text-center')}>
                      {t('table.decimals')}
                    </th>
                    <th scope="col" className={cn(th, 'w-[100px] text-center')}>
                      {t('table.active')}
                    </th>
                    <th scope="col" className={cn(th, 'w-[150px] text-end')}>
                      <span className="sr-only">{t('table.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.data.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-[13px] text-muted-foreground"
                      >
                        {q ? t('empty.noMatch', { q }) : t('empty.none')}
                      </td>
                    </tr>
                  )}
                  {data.data.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/50">
                      <td className="px-4 py-2.5 font-mono font-semibold">
                        {c.code}
                        {c.isDefault && (
                          <span className="ms-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">
                            {t('defaultBadge')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{c.name}</td>
                      <td className="px-4 py-2.5">{c.symbol}</td>
                      <td className="px-4 py-2.5 text-end font-mono" dir="ltr">
                        {rate.format(Number(c.exchangeRate))}
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono">{c.precision}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={!canEdit || toggle.isPending}
                          aria-pressed={c.isActive}
                          aria-label={t('actions.toggle', { code: c.code })}
                          onClick={() => toggle.mutate(c)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 font-mono text-[10.5px]',
                            c.isActive
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-border bg-muted text-muted-foreground',
                          )}
                        >
                          {c.isActive ? t('on') : t('off')}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {canEdit && (
                          <span className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditing(c)}
                              className="rounded-full border border-border px-2.5 py-1 font-mono text-[10.5px] hover:bg-muted"
                            >
                              {t('actions.edit')}
                            </button>
                            {!c.isDefault && (
                              <button
                                type="button"
                                onClick={() => {
                                  remove.reset();
                                  setDeleting(c);
                                }}
                                className="rounded-full border border-danger/40 px-2.5 py-1 font-mono text-[10.5px] text-danger hover:bg-danger/10"
                              >
                                {t('actions.delete')}
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-3">
              <div className="font-mono text-[11px] text-muted-foreground">
                {t('footer', {
                  from: nf.format(data.from),
                  to: nf.format(data.to),
                  total: nf.format(data.total),
                })}
              </div>
              <Pager
                page={data.page}
                pageCount={data.pageCount}
                onGo={(n) => go({ page: n })}
                labels={{
                  nav: tc('pager.label'),
                  previous: tc('pager.previous'),
                  next: tc('pager.next'),
                  page: (n) => tc('pager.page', { n }),
                }}
              />
            </div>
          </>
        ) : (
          <div className="p-5">{notice}</div>
        )}
      </Card>

      {editing && (
        <Modal
          open
          size="md"
          eyebrow={t('form.editEyebrow')}
          title={t('form.editTitle', { code: editing.code })}
          closeLabel={tc('dismiss')}
          onClose={() => setEditing(null)}
        >
          <CurrencyForm
            mode="edit"
            currency={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              toast(t('toasts.updated'));
              setEditing(null);
              await refresh();
            }}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          open
          tone="danger"
          busy={remove.isPending}
          title={t('delete.title')}
          message={
            <div className="space-y-3">
              <p>{t('delete.body', { code: deleting.code })}</p>
              {remove.isError && (
                <Alert tone="danger">
                  {te(cpnErrorKey(remove.error), { used: usedByList(remove.error) })}
                </Alert>
              )}
            </div>
          }
          confirmLabel={t('delete.confirm')}
          cancelLabel={tc('cancel')}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** The "Add a currency" panel and, in a modal, the inline edit Reference's route supported but its screen never offered. */
function CurrencyForm({
  mode,
  currency,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  currency?: CurrencyItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations(`${NS}.form`);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const [draft, setDraft] = useState<CurrencyDraft>(() =>
    currency ? currencyToDraft(currency) : newCurrencyDraft(),
  );
  const [problems, setProblems] = useState<CurrencyField[]>([]);
  const set = <K extends keyof CurrencyDraft>(k: K, v: CurrencyDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      currency
        ? operatorFetch(`/currencies/${currency.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: currency.rowVersion },
            schema: currencyItemSchema,
          })
        : operatorFetch('/currencies', { method: 'POST', body, schema: currencyItemSchema }),
    onSuccess: onSaved,
    // a server refusal that names fields puts the keyboard on the first of them, in form order
    onError: (e) => {
      if (!(e instanceof ApiError) || e.status !== 422) return;
      const named = new Set(e.fieldErrors.map((f) => f.path.split('.')[0]));
      focusFirst(FIELD_ORDER.filter((f) => named.has(f)));
    },
  });

  const focusFirst = (fields: readonly CurrencyField[]) => {
    const first = fields.find((f) => {
      const el = document.getElementById(`cu-${FIELD_ID[f]}-${mode}`);
      return el instanceof HTMLInputElement && !el.disabled;
    });
    if (first) document.getElementById(`cu-${FIELD_ID[first]}-${mode}`)?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildCurrencyRequest(draft);
    if (!r.ok) {
      setProblems(r.problems);
      focusFirst(r.problems);
      return;
    }
    setProblems([]);
    // an edit never sends the code: it is immutable
    const { code: _code, ...rest } = r.body;
    void _code;
    save.mutate(currency ? rest : r.body);
  };

  const serverMessages =
    save.isError && save.error instanceof ApiError && save.error.status === 422
      ? save.error.fieldErrors.map((f) => f.message)
      : [];
  const inputCls = 'h-auto py-2 text-[12.5px]';

  return (
    <form
      onSubmit={submit}
      noValidate
      className={cn(
        mode === 'add' &&
          'overflow-hidden rounded-2xl border border-border bg-background shadow-sm',
      )}
    >
      {mode === 'add' && (
        <div className="border-b border-border px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h3 className="mt-0.5 font-serif text-xl leading-tight">{t('addTitle')}</h3>
        </div>
      )}
      <div
        className={cn(
          'grid grid-cols-1 gap-4 sm:grid-cols-2',
          mode === 'add' ? 'p-5 lg:grid-cols-3' : 'pb-1',
        )}
      >
        {(problems.length > 0 || save.isError) && (
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Problems title={t('problemsTitle')} items={problems.map((f) => t(`problems.${f}`))} />
            {save.isError && problems.length === 0 && (
              <Alert tone="danger">
                {serverMessages.length > 0 ? serverMessages.join(' ') : te(cpnErrorKey(save.error))}
              </Alert>
            )}
          </div>
        )}
        <div>
          <label className={LBL} htmlFor={`cu-name-${mode}`}>
            {t('name')}
          </label>
          <Input
            id={`cu-name-${mode}`}
            value={draft.name}
            maxLength={120}
            invalid={problems.includes('name')}
            onChange={(e) => set('name', e.target.value)}
            placeholder={t('namePlaceholder')}
            className={inputCls}
          />
        </div>
        <div>
          <label className={LBL} htmlFor={`cu-code-${mode}`}>
            {t('code')}
          </label>
          <Input
            id={`cu-code-${mode}`}
            value={draft.code}
            maxLength={3}
            disabled={!!currency}
            invalid={problems.includes('code')}
            onChange={(e) => set('code', e.target.value)}
            placeholder={t('codePlaceholder')}
            className={`${inputCls} font-mono uppercase`}
          />
          {currency && (
            <p className="mt-1 text-[10.5px] text-muted-foreground">{t('codeLocked')}</p>
          )}
        </div>
        <div>
          <label className={LBL} htmlFor={`cu-symbol-${mode}`}>
            {t('symbol')}
          </label>
          <Input
            id={`cu-symbol-${mode}`}
            value={draft.symbol}
            maxLength={20}
            invalid={problems.includes('symbol')}
            onChange={(e) => set('symbol', e.target.value)}
            placeholder={t('symbolPlaceholder')}
            className={inputCls}
          />
        </div>
        <div>
          <label className={LBL} htmlFor={`cu-precision-${mode}`}>
            {t('precision')}
          </label>
          <Input
            id={`cu-precision-${mode}`}
            type="number"
            min={0}
            max={6}
            value={draft.precision}
            invalid={problems.includes('precision')}
            onChange={(e) => set('precision', e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LBL} htmlFor={`cu-rate-${mode}`}>
            {t('rate')}
          </label>
          <Input
            id={`cu-rate-${mode}`}
            inputMode="decimal"
            value={draft.exchangeRate}
            invalid={problems.includes('exchangeRate')}
            onChange={(e) => set('exchangeRate', e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-[10.5px] text-muted-foreground">{t('rateHint')}</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2 lg:col-span-3">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="size-4 rounded border-border accent-primary"
          />
          {t('active')}
        </label>
      </div>
      <div
        className={cn(
          'flex items-center justify-end gap-2',
          mode === 'add' ? 'border-t border-border bg-muted/40 px-5 py-4' : 'pt-3',
        )}
      >
        <Button
          type="button"
          variant="secondary"
          className="rounded-full px-4 text-xs"
          onClick={onClose}
        >
          {t('cancel')}
        </Button>
        <Button type="submit" className="rounded-full px-4 text-xs" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {mode === 'add' ? t('save') : t('saveChanges')}
        </Button>
      </div>
    </form>
  );
}
