'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SalesOrderResponse, TaxRateResponse, InvoiceProfile } from '@crm/contracts';
import { Alert, Button, EmptyState, Field, Input, Spinner, Textarea, cn, useToast } from '@crm/ui';
import { invalidateInvoicing, useInvoiceSettings, useSalesOrder, useTaxRates } from '../api/hooks';
import { useOrderOfQuote, useQuote, type QuoteRow } from '../api/sales-orders-quotes';
import { invoicingApi } from '../api/service';
import { usedIndexes } from '../lib/builder';
import { errorCode, errorKind, fieldErrors } from '../lib/errors';
import {
  buildCreateInput,
  buildUpdateInput,
  draftOfOrder,
  emptyOrderDraft,
  hasOrderProblems,
  isSameOrderDraft,
  linesChanged,
  lineAmountsOf,
  priceOrderDraft,
  validateOrderDraft,
  type OrderDraft,
  type OrderProblems,
} from '../lib/sales-orders';
import { hsnRequired } from '../lib/tax-info';
import { emptyTotals } from '../lib/totals';
import { exponentOf } from '../lib/money';
import { majorToMinor, minorOf } from '../lib/wire';
import { ContactPicker } from './contact-picker';
import { BackIcon } from './icons';
import { InvoiceLinesEditor } from './line-items-editor';
import { ErrorLine, Money, UserText, useDefaultCurrency, useErrorText, useInvoicingCan } from './parts';
import { QuotePicker } from './sales-order-quote-picker';
import { OrderStatusChip, salesOrderHref, newSalesOrderHref } from './sales-order-parts';
import { TotalsCard } from './totals-card';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'JPY', 'KWD', 'CAD', 'AUD', 'SGD', 'CHF'];

/**
 * `/sales-orders/new` and `/sales-orders/[id]/edit`. New: start from an accepted proposal or estimate (`?quote=`, or pick one)
 * or from nothing; `?contact=` and `?deal=` link the order. Edit: a draft only (a confirmed order's prices are frozen: the
 * server says SO_NOT_DRAFT). Waits for the tax rates and the invoice settings, then starts one working copy.
 */
export function SalesOrderBuilder({ orderId }: { orderId?: string }) {
  const t = useTranslations('invoicing.salesOrders.builder');
  const can = useInvoicingCan();
  const rates = useTaxRates({ active: true });
  const settings = useInvoiceSettings();
  const existing = useSalesOrder(orderId ?? null);
  const quoteKey = useSearchParams().get('quote') ?? '';

  const allowed = orderId ? can.updateSalesOrder : can.createSalesOrder;
  if (!allowed) return <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />;
  const failed = rates.error ?? settings.error ?? existing.error;
  if (failed) {
    return (
      <div className="space-y-3">
        <ErrorLine error={failed} onRetry={() => void Promise.all([rates.refetch(), settings.refetch(), existing.refetch()])} />
      </div>
    );
  }
  if (!rates.data || !settings.data || (orderId && !existing.data)) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (existing.data && existing.data.status !== 'draft') {
    return (
      <Alert tone="warning" className="space-y-2">
        <p>{t('frozen')}</p>
        <Link href={salesOrderHref(existing.data.id)} className="font-medium underline underline-offset-2">
          {t('openOrder')}
        </Link>
      </Alert>
    );
  }
  return <BuilderForm key={existing.data?.id ?? `new-${quoteKey}`} order={existing.data} rates={rates.data} settings={settings.data} />;
}

function BuilderForm({
  order,
  rates,
  settings,
}: {
  order: SalesOrderResponse | undefined;
  rates: readonly TaxRateResponse[];
  settings: InvoiceProfile;
}) {
  const t = useTranslations('invoicing.salesOrders.builder');
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const workspaceCurrency = useDefaultCurrency();
  const quoteParam = order ? null : search.get('quote');
  const quote = useQuote(quoteParam);

  const initial = useMemo<OrderDraft>(() => {
    if (order) return draftOfOrder(order, rates);
    const d = emptyOrderDraft(settings.currency || workspaceCurrency, settings.terms ?? '');
    d.dealId = search.get('deal');
    d.quoteId = quoteParam;
    return d;
    // The starting point is read once; later renders must not reset what the person typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraft] = useState<OrderDraft>(initial);
  const [problems, setProblems] = useState<OrderProblems>({ fields: {}, lines: {} });
  const [serverLines, setServerLines] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof OrderDraft>(k: K, v: OrderDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = !isSameOrderDraft(draft, initial);

  // The offer fixes the currency and fills the buyer once it has loaded.
  const filledFromQuote = useRef(false);
  useEffect(() => {
    const q = quote.data;
    if (!q || filledFromQuote.current) return;
    filledFromQuote.current = true;
    setDraft((d) => ({
      ...d,
      currency: q.currency,
      contactId: d.contactId ?? q.contact?.id ?? null,
      contactLabel: d.contactLabel || (q.contact?.name ?? ''),
      dealId: d.dealId ?? q.deal?.id ?? null,
      reference: d.reference || q.number,
    }));
  }, [quote.data]);

  // `?contact=`: fill the buyer from it once.
  const contactParam = order ? null : search.get('contact');
  const contact = useQuery({
    queryKey: ['invoicing', 'prefill-contact', contactParam],
    enabled: !!contactParam,
    retry: false,
    queryFn: ({ signal }) => invoicingApi.contactById(contactParam!, signal),
  });
  const prefilled = useRef(false);
  useEffect(() => {
    const c = contact.data;
    if (!c || prefilled.current) return;
    prefilled.current = true;
    const label = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';
    setDraft((d) => ({
      ...d,
      contactId: c.id,
      contactLabel: label,
      buyerName: d.buyerName || label,
      buyerEmail: d.buyerEmail || (c.email ?? ''),
      buyerPhone: d.buyerPhone || (c.phone ?? ''),
    }));
  }, [contact.data]);

  // Leave-page guard while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const fromQuote = draft.quoteId !== null;
  // A new order from an offer takes its lines from the offer; a saved draft's lines are always editable.
  const linesFromQuote = !order && fromQuote;
  const pricing = useMemo(() => priceOrderDraft(draft, rates), [draft, rates]);
  const requireHsn = hsnRequired(settings.sellerCountry);

  async function save() {
    const p = validateOrderDraft(draft, { requireHsn, creating: !order, linesTouched: linesChanged(draft, initial) });
    setProblems(p);
    setServerLines({});
    setError(null);
    if (hasOrderProblems(p)) {
      toast(t('fixProblems'), 'danger');
      return;
    }
    setBusy(true);
    try {
      const out = order
        ? await invoicingApi.updateSalesOrder(order.id, order.rowVersion, buildUpdateInput(draft, initial, rates))
        : await invoicingApi.createSalesOrder(buildCreateInput(draft, rates));
      await invalidateInvoicing(qc);
      toast(order ? t('saved') : t('created', { number: out.number }));
      router.replace(salesOrderHref(out.id));
    } catch (e) {
      if (errorKind(e) === 'conflict') setConflict(true);
      else {
        // The server counts only the lines it received (blank ones are dropped): map its indexes back onto the form's.
        const used = usedIndexes(draft.lines);
        const mapped: Record<string, string> = {};
        for (const [path, message] of Object.entries(fieldErrors(e))) {
          const m = /^lines\.(\d+)\.(.+)$/.exec(path);
          if (m) mapped[`lines.${used[Number(m[1])] ?? m[1]}.${m[2]}`] = message;
          else mapped[path] = message;
        }
        setServerLines(mapped);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (k: keyof OrderProblems['fields']) => (problems.fields[k] ? t(`problems.${problems.fields[k]}`) : (serverLines[SERVER_FIELD[k]] ?? undefined));
  const lineErrors: Record<string, string> = { ...serverLines };
  for (const [path, problem] of Object.entries(problems.lines)) lineErrors[path] = t(`lineProblems.${problem}`);
  if (problems.list) lineErrors.lines = t(`problems.${problems.list}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={order ? salesOrderHref(order.id) : '/sales-orders'}
            aria-label={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
          >
            <BackIcon />
          </Link>
          <h1 className="truncate text-xl font-bold tracking-tight">{order ? t('editTitle', { number: order.number }) : t('newTitle')}</h1>
          {order && <OrderStatusChip status={order.status} />}
          {dirty && <span className="shrink-0 text-xs text-muted-foreground">{t('unsaved')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="min-h-10" onClick={() => router.push(order ? salesOrderHref(order.id) : '/sales-orders')} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" className="min-h-10" onClick={() => void save()} disabled={busy || (linesFromQuote && !quote.data && quote.isPending)}>
            {busy && <Spinner />}
            {order ? t('saveChanges') : t('createDraft')}
          </Button>
        </div>
      </div>

      {conflict && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('conflict')}</span>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t('reload')}
          </Button>
        </Alert>
      )}
      {error !== null && <SaveError error={error} quote={quote.data ?? null} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-4">
          {!order && <SourceCard quoteId={draft.quoteId} quote={quote.data} quoteLoading={!!quoteParam && quote.isPending} quoteFailed={quote.error} />}

          <Card title={t('buyer')}>
            <Field label={t('contact')} htmlFor="so-contact" hint={t('contactHint')} className="sm:col-span-2" error={fieldErr('buyer')}>
              <ContactPicker
                id="so-contact"
                invalid={!!problems.fields.buyer}
                disabled={busy}
                value={draft.contactId ? { id: draft.contactId, label: draft.contactLabel || draft.buyerName } : null}
                onChange={(c) =>
                  setDraft((d) => ({
                    ...d,
                    contactId: c?.id ?? null,
                    contactLabel: c?.label ?? '',
                    buyerName: c ? c.label : d.buyerName,
                    buyerEmail: c ? (c.email ?? d.buyerEmail) : d.buyerEmail,
                    buyerPhone: c ? (c.phone ?? d.buyerPhone) : d.buyerPhone,
                  }))
                }
              />
            </Field>
            <Field label={t('buyerName')} htmlFor="so-name" hint={fromQuote ? t('fromQuoteHint') : undefined}>
              <Input id="so-name" dir="auto" disabled={busy} value={draft.buyerName} onChange={(e) => set('buyerName', e.target.value)} />
            </Field>
            <Field label={t('buyerEmail')} htmlFor="so-email" error={fieldErr('email')}>
              <Input id="so-email" type="email" dir="ltr" disabled={busy} value={draft.buyerEmail} invalid={!!problems.fields.email} onChange={(e) => set('buyerEmail', e.target.value)} />
            </Field>
            <Field label={t('buyerPhone')} htmlFor="so-phone">
              <Input id="so-phone" type="tel" dir="ltr" disabled={busy} value={draft.buyerPhone} onChange={(e) => set('buyerPhone', e.target.value)} />
            </Field>
          </Card>

          <Card title={t('details')}>
            <Field label={t('currency')} htmlFor="so-currency" hint={order || fromQuote ? t('currencyLocked') : t('currencyHint')} error={fieldErr('currency')}>
              <Input
                id="so-currency"
                dir="ltr"
                list="so-currencies"
                maxLength={3}
                disabled={busy || !!order || fromQuote}
                value={draft.currency}
                invalid={!!problems.fields.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
              />
              <datalist id="so-currencies">
                {[...new Set([draft.currency, ...CURRENCIES])].filter(Boolean).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label={t('expectedDate')} htmlFor="so-expected" hint={t('expectedHint')} error={fieldErr('expectedDate')}>
              <Input id="so-expected" type="date" dir="ltr" disabled={busy} value={draft.expectedDate} invalid={!!problems.fields.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} />
            </Field>
            <Field label={t('reference')} htmlFor="so-ref" hint={t('referenceHint')} error={fieldErr('reference')} className="sm:col-span-2">
              <Input id="so-ref" dir="auto" maxLength={191} disabled={busy} value={draft.reference} invalid={!!problems.fields.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
          </Card>

          {linesFromQuote ? (
            <Card title={t('linesFromQuote')} single>
              <p className="text-sm text-muted-foreground">{t('linesFromQuoteHint')}</p>
            </Card>
          ) : (
            <Card title={t('lineItems')} single>
              <InvoiceLinesEditor
                lines={draft.lines}
                onChange={(lines) => set('lines', lines)}
                currency={draft.currency || workspaceCurrency}
                taxRates={rates}
                showHsn={requireHsn}
                disabled={busy}
                errors={lineErrors}
                amounts={lineAmountsOf(draft, pricing)}
              />
            </Card>
          )}

          <Card title={t('shippingNotes')}>
            <Field label={t('shipping', { currency: draft.currency })} htmlFor="so-shipping" hint={t('shippingHint')} error={fieldErr('shipping')}>
              <Input id="so-shipping" inputMode="decimal" dir="ltr" disabled={busy} value={draft.shipping} placeholder="0" invalid={!!problems.fields.shipping} onChange={(e) => set('shipping', e.target.value)} />
            </Field>
            <div className="hidden sm:block" />
            <Field label={t('notes')} htmlFor="so-notes" hint={t('notesHint')} className="sm:col-span-2">
              <Textarea id="so-notes" rows={3} dir="auto" disabled={busy} maxLength={5000} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <Field label={t('terms')} htmlFor="so-terms" hint={t('termsHint')} className="sm:col-span-2">
              <Textarea id="so-terms" rows={3} dir="auto" disabled={busy} maxLength={10000} value={draft.terms} onChange={(e) => set('terms', e.target.value)} />
            </Field>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          {linesFromQuote ? (
            <QuoteTotals quote={quote.data} order={order} />
          ) : (
            <TotalsCard
              totals={pricing?.totals ?? emptyTotals(draft.currency || workspaceCurrency)}
              currency={draft.currency || workspaceCurrency}
              issues={pricing && !pricing.ok ? pricing.issues.map((i) => i.message) : undefined}
            />
          )}
          <p className="text-xs text-muted-foreground">{t('draftNote')}</p>
        </div>
      </div>
    </div>
  );
}

/** Server field name behind each form field, for messages the server sent. */
const SERVER_FIELD = { buyer: 'buyerName', email: 'buyerEmail', currency: 'currency', expectedDate: 'expectedDate', shipping: 'shipping', reference: 'reference' } as const;

function Card({ title, children, single }: { title: string; children: React.ReactNode; single?: boolean }) {
  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className={cn(single ? 'space-y-3' : 'grid gap-3 sm:grid-cols-2')}>{children}</div>
    </section>
  );
}

/** New order only: the chosen offer, or the picker (and the choice between an offer and nothing). */
function SourceCard({
  quoteId,
  quote,
  quoteLoading,
  quoteFailed,
}: {
  quoteId: string | null;
  quote: QuoteRow | undefined;
  quoteLoading: boolean;
  quoteFailed: unknown;
}) {
  const t = useTranslations('invoicing.salesOrders.builder');
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<'scratch' | 'quote'>(quoteId ? 'quote' : 'scratch');
  const go = (id: string | null) => {
    const p = new URLSearchParams(search.toString());
    if (id) p.set('quote', id);
    else p.delete('quote');
    // The form is keyed by the offer in the address: replacing it restarts the form with the offer's data.
    router.replace(`/sales-orders/new${p.toString() ? `?${p}` : ''}`);
  };
  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('startFrom')}</h2>
      <div role="radiogroup" aria-label={t('startFrom')} className="grid gap-2 sm:grid-cols-2">
        {(['scratch', 'quote'] as const).map((m) => (
          <label
            key={m}
            className={cn(
              'flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
              mode === m ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name="so-source"
              className="size-4 accent-[var(--primary)]"
              checked={mode === m}
              onChange={() => {
                setMode(m);
                if (m === 'scratch' && quoteId) go(null);
              }}
            />
            {t(`source.${m}`)}
          </label>
        ))}
      </div>
      {mode === 'quote' && (
        <>
          {quoteLoading && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('loadingQuote')}
            </div>
          )}
          {quoteFailed !== null && quoteFailed !== undefined && <ErrorLine error={quoteFailed} />}
          {quote && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span dir="ltr" className="font-medium">
                  {quote.number}
                </span>{' '}
                <UserText className="text-muted-foreground">{[quote.title, quote.buyerName].filter(Boolean).join(' - ')}</UserText>
              </span>
              <Money minor={minorOf(quote.totals.totalMinor)} currency={quote.currency} className="font-medium" />
            </div>
          )}
          <QuotePicker selectedId={quoteId} onPick={(row) => go(row.id)} />
        </>
      )}
    </section>
  );
}

function QuoteTotals({ quote, order }: { quote: QuoteRow | undefined; order: SalesOrderResponse | undefined }) {
  const t = useTranslations('invoicing.salesOrders.builder');
  const currency = order?.currency ?? quote?.currency;
  const total = order ? order.amounts.total : quote?.totals.total;
  if (!currency || total === undefined) return null;
  const major = order ? order.amounts : quote ? { subtotal: quote.totals.subtotal, discount: quote.totals.discount, tax: quote.totals.tax, total: quote.totals.total } : null;
  if (!major) return null;
  const row = (label: string, value: string, strong?: boolean) => (
    <div className={cn('flex items-baseline justify-between gap-3', strong && 'border-t border-border pt-2 text-lg font-bold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd>
        <Money minor={moneyMinor(value, currency)} currency={currency} />
      </dd>
    </div>
  );
  return (
    <section aria-label={t('quoteTotals')} className="rounded-lg border border-border bg-background p-4 text-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('quoteTotals')}</h2>
      <dl className="space-y-1.5">
        {row(t('subtotal'), major.subtotal)}
        {moneyMinor(major.discount, currency) > 0 && row(t('discount'), major.discount)}
        {row(t('tax'), major.tax)}
        {row(t('total'), major.total, true)}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">{t('quoteTotalsNote')}</p>
    </section>
  );
}

const moneyMinor = (s: string, currency: string): number => majorToMinor(s, exponentOf(currency));

/** A failed save, in our words. A quote that is not accepted or already has an order says so, with a link to that order. */
function SaveError({ error, quote }: { error: unknown; quote: QuoteRow | null }) {
  const t = useTranslations('invoicing.salesOrders.builder');
  const errorText = useErrorText();
  const code = errorCode(error);
  const taken = code === 'SO_QUOTE_TAKEN';
  const existing = useOrderOfQuote(taken && quote ? { id: quote.id, number: quote.number } : null);
  return (
    <Alert tone="danger" className="space-y-1">
      <p>{Object.keys(fieldErrors(error)).length > 0 && errorKind(error) === 'validation' ? t('serverRejected') : errorText(error)}</p>
      {taken && existing.data && (
        <Link href={salesOrderHref(existing.data.id)} className="inline-block font-medium underline underline-offset-2">
          {t('openExisting', { number: existing.data.number })}
        </Link>
      )}
      {taken && (
        <Link href="/sales-orders" className="ms-3 inline-block font-medium underline underline-offset-2">
          {t('viewOrders')}
        </Link>
      )}
      {code === 'SO_QUOTE_NOT_ACCEPTED' && (
        <Link href={newSalesOrderHref()} className="inline-block font-medium underline underline-offset-2">
          {t('pickAnother')}
        </Link>
      )}
    </Alert>
  );
}
