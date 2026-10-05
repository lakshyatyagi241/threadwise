'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InvoiceProfile, InvoiceResponse, TaxRateResponse } from '@crm/contracts';
import { Alert, Button, Spinner, cn, useToast } from '@crm/ui';
import {
  KEYS,
  invalidateInvoicing,
  useInvoice,
  useInvoiceSettings,
  useTaxRates,
} from '../api/hooks';
import { invoicingApi } from '../api/service';
import {
  draftOf,
  draftToBody,
  emptyDraft,
  hasProblems,
  isSameDraft,
  pricingOf,
  serverPath,
  validateDraft,
  withContact,
  type DraftProblems,
  type InvoiceDraft,
  type Problem,
} from '../lib/builder';
import { errorCode, errorKind, fieldErrors } from '../lib/errors';
import { paperFromDraft } from '../lib/paper';
import { hsnRequired } from '../lib/tax-info';
import {
  AdjustmentsSection,
  BuyerSection,
  DetailsSection,
  NotesSection,
  TaxSection,
  Card,
} from './builder-sections';
import { BackIcon } from './icons';
import { InvoicePaper } from './invoice-paper';
import { InvoiceLinesEditor } from './line-items-editor';
import { ErrorLine, useDefaultCurrency, useErrorText, useInvoicingCan, useToday } from './parts';
import { TaxWhyPreview } from './tax-why';
import { TotalsCard } from './totals-card';

/**
 * `/invoices/new` and `/invoices/[id]/edit`: buyer (contact, tax id, country), dates and currency, the tax (a rate per line, or the
 * tax engine deciding from the countries involved), line items, discount and shipping, notes, live totals and a live preview of the
 * paper. Edit mode loads a DRAFT (an issued invoice goes to its detail: it is frozen). A save sends decimal strings in major units;
 * what the server answers (`amounts`, `taxSummary`) is what the saved invoice shows.
 */
export function InvoiceBuilder({ invoiceId }: { invoiceId?: string }) {
  const search = useSearchParams();
  const fromDoc = invoiceId ? null : search.get('fromDoc');
  const duplicate = invoiceId ? null : search.get('duplicate');
  if (fromDoc) return <StartFromDocument docId={fromDoc} />;
  if (duplicate) return <StartFromDuplicate invoiceId={duplicate} />;
  return <BuilderLoader invoiceId={invoiceId} />;
}

/** `?fromDoc=<salesDocId>`: the server turns the accepted proposal or estimate into a draft (once per document); open it. */
function StartFromDocument({ docId }: { docId: string }) {
  const t = useTranslations('invoicing.builder');
  const router = useRouter();
  const errorText = useErrorText();
  const started = useRef(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [existing, setExisting] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    invoicingApi
      .convertSalesDoc(docId)
      .then(({ invoiceId }) => router.replace(`/invoices/${invoiceId}/edit`))
      .catch(async (e: unknown) => {
        setFailed(e);
        if (errorCode(e) === 'SALESDOC_ALREADY_CONVERTED') {
          // Someone converted it already: send them to that invoice instead of leaving a dead end.
          try {
            setExisting(await invoicingApi.salesDocInvoiceId(docId));
          } catch {
            /* the message and the way back stay */
          }
        }
      });
  }, [docId, router]);

  if (failed) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{errorText(failed)}</Alert>
        <div className="flex flex-wrap gap-3 text-sm">
          {existing && (
            <Link
              href={`/invoices/${existing}`}
              className="font-medium text-primary underline underline-offset-2"
            >
              {t('openExisting')}
            </Link>
          )}
          <Link href="/invoices" className="text-muted-foreground underline underline-offset-2">
            {t('backToInvoices')}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
      <Spinner /> {t('creatingFromDocument')}
    </div>
  );
}

/** `?duplicate=<invoiceId>`: the server copies the invoice into a new draft; open it for editing. */
function StartFromDuplicate({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('invoicing.builder');
  const router = useRouter();
  const errorText = useErrorText();
  const started = useRef(false);
  const [failed, setFailed] = useState<unknown>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    invoicingApi
      .duplicate(invoiceId)
      .then((copy) => router.replace(`/invoices/${copy.id}/edit`))
      .catch((e: unknown) => setFailed(e));
  }, [invoiceId, router]);
  if (failed) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{errorText(failed)}</Alert>
        <Link
          href={`/invoices/${invoiceId}`}
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          {t('backToInvoice')}
        </Link>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
      <Spinner /> {t('duplicating')}
    </div>
  );
}

function BuilderLoader({ invoiceId }: { invoiceId?: string }) {
  const t = useTranslations('invoicing.builder');
  const router = useRouter();
  const active = useTaxRates({ active: true });
  const all = useTaxRates();
  const settings = useInvoiceSettings();
  const existing = useInvoice(invoiceId ?? null);

  // An issued invoice is frozen: the detail is where it lives.
  const notDraft = existing.data && existing.data.status !== 'draft' ? existing.data.id : null;
  useEffect(() => {
    if (notDraft) router.replace(`/invoices/${notDraft}`);
  }, [notDraft, router]);

  // The rates a line can be PICKED from are the active ones (inside their effective dates); every other rate is only looked up.
  const rates = useMemo<TaxRateResponse[] | null>(() => {
    if (!active.data || !all.data) return null;
    const pickable = new Set(active.data.map((r) => r.id));
    return all.data.map((r) => ({ ...r, isActive: pickable.has(r.id) }));
  }, [active.data, all.data]);

  const failed = active.error ?? all.error ?? settings.error ?? existing.error;
  if (failed) {
    return (
      <ErrorLine
        error={failed}
        onRetry={() =>
          void Promise.all([
            active.refetch(),
            all.refetch(),
            settings.refetch(),
            existing.refetch(),
          ])
        }
      />
    );
  }
  if (notDraft) {
    return (
      <Alert tone="warning" className="space-y-2">
        <p>{t('notEditable')}</p>
        <Link href={`/invoices/${notDraft}`} className="font-medium underline underline-offset-2">
          {t('openInvoice')}
        </Link>
      </Alert>
    );
  }
  if (!rates || !settings.data || (invoiceId && !existing.data)) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  return (
    <BuilderForm
      key={existing.data?.id ?? 'new'}
      invoice={existing.data}
      rates={rates}
      profile={settings.data}
    />
  );
}

function BuilderForm({
  invoice,
  rates,
  profile,
}: {
  invoice: InvoiceResponse | undefined;
  rates: TaxRateResponse[];
  profile: InvoiceProfile;
}) {
  const t = useTranslations('invoicing.builder');
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const can = useInvoicingCan();
  const today = useToday();
  const workspaceCurrency = useDefaultCurrency();

  const initial = useMemo<InvoiceDraft>(() => {
    if (invoice) return draftOf(invoice);
    const d = emptyDraft(profile, today, workspaceCurrency);
    d.dealId = search.get('deal');
    return d;
    // The starting point is read once; later renders must not reset what the person typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraftState] = useState<InvoiceDraft>(initial);
  const setDraft = (update: (d: InvoiceDraft) => InvoiceDraft) => setDraftState(update);
  const [attempt, setAttempt] = useState<'draft' | 'issue' | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [issuedElsewhere, setIssuedElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const rowVersion = useRef(invoice?.rowVersion ?? 0);
  const orderLinked = !!invoice?.salesOrder;
  const dirty = !isSameDraft(draft, initial);

  // A new invoice for a contact (`?contact=`) or a deal (`?deal=`): fill the buyer from it once.
  const contactParam = invoice ? null : search.get('contact');
  const dealParam = invoice ? null : search.get('deal');
  const contact = useQuery({
    queryKey: ['invoicing', 'prefill-contact', contactParam],
    enabled: !!contactParam,
    retry: false,
    queryFn: ({ signal }) => invoicingApi.contactById(contactParam!, signal),
  });
  const deal = useQuery({
    queryKey: ['invoicing', 'prefill-deal', dealParam],
    enabled: !!dealParam,
    retry: false,
    queryFn: ({ signal }) => invoicingApi.dealById(dealParam!, signal),
  });
  const prefilled = useRef({ contact: false, deal: false });
  useEffect(() => {
    const c = contact.data;
    if (!c || prefilled.current.contact) return;
    prefilled.current.contact = true;
    const label = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';
    setDraftState((d) =>
      withContact(d, { id: c.id, label, email: c.email ?? null, phone: c.phone ?? null }),
    );
  }, [contact.data]);
  useEffect(() => {
    const dl = deal.data;
    if (!dl || prefilled.current.deal) return;
    prefilled.current.deal = true;
    setDraftState((d) => ({
      ...d,
      dealId: dl.id,
      companyId: d.companyId ?? dl.company?.id ?? null,
      // A contact picked through `?contact=` wins over the deal's.
      ...(d.contactId || !dl.contact
        ? {}
        : {
            contactId: dl.contact.id,
            contactLabel: dl.contact.name ?? '',
            buyerName: d.buyerName || (dl.contact.name ?? ''),
            buyerPhone: d.buyerPhone || (dl.contact.phone ?? ''),
          }),
    }));
  }, [deal.data]);

  // Leave-page guard while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const pricing = useMemo(
    () => pricingOf(draft, { rates, profile, today }),
    [draft, rates, profile, today],
  );
  const showHsn = hsnRequired(profile.sellerCountry);
  const paper = useMemo(
    () => paperFromDraft(draft, pricing, { profile, rates }),
    [draft, pricing, profile, rates],
  );

  // What is wrong, by path. Until a save was tried, "required" notes stay quiet; wrong values show as they are typed.
  const problems = useMemo<DraftProblems>(() => {
    const all = validateDraft(draft, pricing, {
      mode: attempt ?? 'draft',
      requireHsn: showHsn && !orderLinked,
      sellerCountry: profile.sellerCountry,
    });
    if (attempt) return all;
    const quiet: Problem[] = ['descriptionRequired', 'contactRequired', 'noLines', 'amountZero'];
    return Object.fromEntries(Object.entries(all).filter(([, p]) => !quiet.includes(p)));
  }, [draft, pricing, attempt, showHsn, orderLinked, profile.sellerCountry]);
  const error = (path: string): string | undefined =>
    problems[path] ? t(`problems.${problems[path]}`) : serverErrors[path];
  const lineErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const path of new Set([...Object.keys(problems), ...Object.keys(serverErrors)])) {
      if (path === 'lines' || path.startsWith('lines.'))
        out[path] = problems[path] ? t(`problems.${problems[path]}`) : serverErrors[path]!;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, serverErrors]);
  const amounts = useMemo(() => {
    const out: Array<number | null> = draft.lines.map(() => null);
    if (pricing.result.ok)
      pricing.used.forEach((di, k) => (out[di] = pricing.result.totals.lines[k]?.netMinor ?? 0));
    return out;
  }, [draft.lines, pricing]);
  const priceIssues = pricing.result.ok
    ? []
    : [...new Set(Object.values(problems).filter((p) => p === 'amountInvalid'))].map((p) =>
        t(`problems.${p}`),
      );

  async function persist(mode: 'draft' | 'issue'): Promise<InvoiceResponse | null> {
    setAttempt(mode);
    setFormError(null);
    setServerErrors({});
    const p = validateDraft(draft, pricing, {
      mode,
      requireHsn: showHsn && !orderLinked,
      sellerCountry: profile.sellerCountry,
    });
    if (hasProblems(p)) {
      toast(t('fixProblems'), 'danger');
      return null;
    }
    setBusy(true);
    try {
      const body = draftToBody(draft, rates, profile.sellerCountry);
      // The lines of an invoice made from a sales order are fixed: the server refuses them (409 INV_ORDER_LINKED), so they stay out.
      const { lines: _fixed, ...withoutLines } = body;
      const out = invoice
        ? await invoicingApi.update(
            invoice.id,
            rowVersion.current,
            orderLinked ? withoutLines : body,
          )
        : await invoicingApi.create(body);
      rowVersion.current = out.rowVersion;
      await invalidateInvoicing(qc);
      return out;
    } catch (e) {
      if (errorKind(e) === 'conflict') setConflict(true);
      else {
        // The draft was issued meanwhile (somewhere else): its detail is where it lives now.
        if (errorCode(e) === 'INV_NOT_DRAFT') setIssuedElsewhere(true);
        // A tax rate went inactive or expired: reload the list so the pick is a current one.
        if (errorCode(e) === 'INV_TAX_RATE_INVALID')
          void qc.invalidateQueries({ queryKey: KEYS.rates });
        const server = fieldErrors(e);
        const mapped = Object.fromEntries(
          Object.entries(server).map(([path, msg]) => [serverPath(path, pricing.used), msg]),
        );
        setServerErrors(mapped);
        setFormError(errorText(e));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const out = await persist('draft');
    if (!out) return;
    toast(t('saved'));
    router.replace(`/invoices/${out.id}`);
  }

  async function saveAndIssue() {
    const out = await persist('issue');
    if (!out) return;
    setBusy(true);
    try {
      const issued = await invoicingApi.issue(out.id, {
        rowVersion: out.rowVersion,
        ...(draft.issueDate ? { issueDate: draft.issueDate } : {}),
        ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      });
      await invalidateInvoicing(qc);
      toast(t('issued'));
      router.replace(`/invoices/${issued.id}`);
    } catch (e) {
      // The draft is saved; only the issue failed. Say so and stay on the draft, so nothing typed is lost.
      toast(t('savedNotIssued', { reason: errorText(e) }), 'danger');
      setFormError(errorText(e));
      if (!invoice) router.replace(`/invoices/${out.id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  const canSave = invoice ? can.update : can.create;
  const back = invoice ? `/invoices/${invoice.id}` : '/invoices';
  const common = { draft, setDraft, error, disabled: busy };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={back}
            aria-label={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted rtl:rotate-180"
          >
            <BackIcon />
          </Link>
          <h1 className="truncate text-xl font-bold tracking-tight">
            {invoice ? t('editTitle') : t('newTitle')}
          </h1>
          {dirty && <span className="shrink-0 text-xs text-muted-foreground">{t('unsaved')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="min-h-10"
            onClick={() => router.push(back)}
            disabled={busy}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="secondary"
            className="min-h-10"
            onClick={() => void saveDraft()}
            disabled={busy || !canSave}
          >
            {busy && <Spinner />}
            {t('saveDraft')}
          </Button>
          <Button
            variant="brand"
            className="min-h-10"
            onClick={() => void saveAndIssue()}
            disabled={busy || !canSave || !can.issue}
          >
            {t('saveAndIssue')}
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
      {formError && (
        <Alert tone="danger" className="space-y-1">
          <p>{formError}</p>
          {issuedElsewhere && invoice && (
            <Link
              href={`/invoices/${invoice.id}`}
              className="font-medium underline underline-offset-2"
            >
              {t('openInvoice')}
            </Link>
          )}
        </Alert>
      )}

      <div
        role="tablist"
        aria-label={t('viewLabel')}
        className="flex gap-1 rounded-md bg-muted p-1 lg:hidden"
      >
        {(['edit', 'preview'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn(
              'min-h-10 flex-1 rounded px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
              tab === v ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className={cn('min-w-0 space-y-4', tab === 'preview' && 'hidden lg:block')}>
          <BuyerSection {...common} sellerCountry={profile.sellerCountry} />
          <DetailsSection {...common} />
          <TaxSection {...common} profile={profile} />
          <Card title={t('lineItems')} single>
            {orderLinked && (
              <p className="mb-3 text-sm text-muted-foreground">{t('orderLinkedNote')}</p>
            )}
            <InvoiceLinesEditor
              lines={draft.lines}
              onChange={(lines) => setDraft((d) => ({ ...d, lines }))}
              currency={draft.currency.trim().toUpperCase() || 'USD'}
              taxRates={rates}
              showHsn={showHsn}
              disabled={busy || orderLinked}
              errors={lineErrors}
              taxMode={draft.taxMode}
              amounts={amounts}
            />
          </Card>
          <AdjustmentsSection {...common} />
          <NotesSection {...common} />
        </div>

        <aside
          className={cn(
            'min-w-0 space-y-4 lg:sticky lg:top-4',
            tab === 'edit' && 'hidden lg:block',
          )}
        >
          <TotalsCard
            totals={pricing.result.totals}
            currency={draft.currency.trim().toUpperCase() || 'USD'}
            reverseCharge={pricing.reverseCharge}
            issues={priceIssues}
          />
          {draft.taxMode === 'auto' && pricing.auto?.ok && (
            <TaxWhyPreview
              preview={pricing.auto.preview}
              placeOfSupply={paper.placeOfSupply}
              reverseCharge={pricing.reverseCharge}
            />
          )}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('preview')}
            </h2>
            <div className="thin-scrollbar max-h-[70vh] overflow-auto rounded-lg">
              <InvoicePaper model={paper} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
