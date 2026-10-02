'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  type CreditNoteResponse,
  type CreditNoteSettlement,
  type InvoiceSummary,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, Textarea, cn, useToast } from '@crm/ui';
import { invalidateInvoicing, KEYS, useCreditNote, useInvoice, useTaxRates } from '../api/hooks';
import { invoicingApi } from '../api/service';
import {
  CREDIT_NOTE_SETTLEMENTS,
  CREDIT_REASON_ORDER,
  buildCreatePayload,
  buildUpdatePayload,
  creditedByLine,
  emptyForm,
  estimateCredit,
  formFromCreditNote,
  formProblems,
  invoiceFactsOf,
  num,
  type CreditForm,
  type FormProblem,
} from '../lib/credit-notes';
import { errorKind } from '../lib/errors';
import { BackIcon } from './icons';
import { creditNoteHref } from './credit-notes-parts';
import { CreditEstimate } from './credit-notes-estimate';
import { CreditInvoicePicker, NotCreditableAlert } from './credit-notes-invoice-picker';
import { CreditLinesPicker } from './credit-notes-lines';
import { ErrorLine, Money, useErrorText, useInvoicingCan, useToday } from './parts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDITABLE = new Set(['issued', 'partially_paid', 'overdue', 'paid']);

/**
 * What the ISSUED credit notes of an invoice already took from each line, so the builder can show how much of a line is left.
 * The list has no lines, so the issued notes are read one by one (an invoice has a handful).
 */
export function useInvoiceCredits(invoiceId: string | null) {
  const list = useQuery({
    queryKey: [...KEYS.creditNotes, 'of-invoice', invoiceId],
    queryFn: ({ signal }) =>
      invoicingApi.creditNotes({ invoiceId: invoiceId!, status: 'issued', limit: 200 }, signal),
    enabled: invoiceId !== null,
    retry: false,
  });
  const details = useQueries({
    queries: (list.data?.items ?? []).map((n) => ({
      queryKey: [...KEYS.creditNotes, 'one', n.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => invoicingApi.creditNote(n.id, signal),
      retry: false,
    })),
  });
  const notes = details.flatMap((d) => (d.data ? [d.data] : []));
  const notesKey = notes.map((n) => `${n.id}:${n.rowVersion}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const credited = useMemo(() => creditedByLine(notes), [notesKey]);
  return {
    credited,
    hasIssued: (list.data?.items.length ?? 0) > 0,
    isPending: invoiceId !== null && (list.isPending || details.some((d) => d.isPending)),
    error: list.error ?? details.find((d) => d.error)?.error ?? null,
    refetch: () => void list.refetch(),
  };
}

/**
 * `/credit-notes/new` (with `?invoice=<id>` the invoice is preselected) and `/credit-notes/[id]/edit` (a draft). Pick an issued
 * invoice, say why, how the money settles, and what to credit: the whole remaining invoice, or lines and quantities, plus
 * free-form amounts. A live estimate shows the credit and its tax per rate; the server's figures are the truth after saving.
 */
export function CreditNoteBuilder({ id }: { id?: string }) {
  const t = useTranslations('invoicing.creditNotes.builder');
  const search = useSearchParams();
  const can = useInvoicingCan();
  const [generation, setGeneration] = useState(0);
  const note = useCreditNote(id ?? null);
  const noteInvoice = useInvoice(note.data?.invoice.id ?? null);
  const rates = useTaxRates({ active: true });
  const taxRates = rates.data ?? [];

  const editing = id !== undefined;

  if (!can.createCreditNote) {
    return (
      <div className="space-y-3">
        <Alert tone="warning">{t('noAccess')}</Alert>
        <Link href="/credit-notes" className="text-sm text-primary underline underline-offset-2">
          {t('backToList')}
        </Link>
      </div>
    );
  }

  if (editing) {
    if (note.isPending || (note.data && noteInvoice.isPending) || rates.isPending)
      return <BuilderLoading />;
    if (note.isError || !note.data)
      return <BuilderError error={note.error} onRetry={() => void note.refetch()} />;
    if (noteInvoice.isError || !noteInvoice.data)
      return <BuilderError error={noteInvoice.error} onRetry={() => void noteInvoice.refetch()} />;
    if (note.data.status !== 'draft') return <NotDraft note={note.data} />;
    const initial = formFromCreditNote(note.data, invoiceFactsOf(noteInvoice.data), taxRates);
    return (
      <BuilderForm
        key={`${note.data.id}-${note.data.rowVersion}-${generation}`}
        initial={initial}
        note={note.data}
        taxRates={taxRates}
        onReload={() => {
          void note.refetch();
          setGeneration((g) => g + 1);
        }}
      />
    );
  }

  const preset = search.get('invoice') ?? '';
  return (
    <BuilderForm
      initial={emptyForm(UUID.test(preset) ? preset : null)}
      note={null}
      taxRates={taxRates}
      onReload={() => undefined}
    />
  );
}

function BuilderLoading() {
  const t = useTranslations('invoicing.creditNotes.builder');
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
      <Spinner /> {t('loading')}
    </div>
  );
}

function BuilderError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('invoicing.creditNotes.builder');
  return (
    <div className="space-y-3">
      <ErrorLine error={error} onRetry={onRetry} />
      <Link href="/credit-notes" className="text-sm text-primary underline underline-offset-2">
        {t('backToList')}
      </Link>
    </div>
  );
}

function NotDraft({ note }: { note: CreditNoteResponse }) {
  const t = useTranslations('invoicing.creditNotes.builder');
  return (
    <div className="space-y-3">
      <Alert tone="warning">{t('notDraft')}</Alert>
      <Link
        href={creditNoteHref(note.id)}
        className="text-sm text-primary underline underline-offset-2"
      >
        {t('openIt')}
      </Link>
    </div>
  );
}

function BuilderForm({
  initial,
  note,
  taxRates,
  onReload,
}: {
  initial: CreditForm;
  note: CreditNoteResponse | null;
  taxRates: Parameters<typeof estimateCredit>[3];
  onReload: () => void;
}) {
  const t = useTranslations('invoicing.creditNotes.builder');
  const tr = useTranslations('invoicing.creditNotes.reasons');
  const tp = useTranslations('invoicing.creditNotes.problems');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const can = useInvoicingCan();
  const today = useToday();

  const [form, setForm] = useState<CreditForm>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<'save' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const patch = (p: Partial<CreditForm>) => setForm((f) => ({ ...f, ...p }));

  const invoice = useInvoice(form.invoiceId);
  const credits = useInvoiceCredits(form.invoiceId);
  const facts = invoice.data ? invoiceFactsOf(invoice.data) : null;
  const creditable = invoice.data ? CREDITABLE.has(invoice.data.status) : true;

  const problems = useMemo(
    () => formProblems(form, facts, credits.credited),
    [form, facts, credits.credited],
  );
  const shown = useMemo(() => {
    if (tried) return problems;
    const out: Record<string, FormProblem> = {};
    for (const [k, v] of Object.entries(problems)) if (k.startsWith('qty:')) out[k] = v;
    return out;
  }, [problems, tried]);

  const estimate = useMemo(
    () =>
      facts ? estimateCredit(form, facts, credits.credited, taxRates, credits.hasIssued) : null,
    [form, facts, credits.credited, credits.hasIssued, taxRates],
  );

  const pickInvoice = (inv: InvoiceSummary) =>
    setForm((f) => ({
      ...emptyForm(inv.id),
      reason: f.reason,
      note: f.note,
      settlement: f.settlement,
      issueDate: f.issueDate,
    }));

  const blocked = Object.keys(problems).length > 0 || !creditable || !facts || credits.isPending;

  async function save(thenIssue: boolean) {
    setTried(true);
    if (blocked || !facts) return;
    setBusy(thenIssue ? 'issue' : 'save');
    setError(null);
    setConflict(false);
    let saved: CreditNoteResponse;
    try {
      saved = note
        ? await invoicingApi.updateCreditNote(
            note.id,
            note.rowVersion,
            buildUpdatePayload(form, facts, credits.credited),
          )
        : await invoicingApi.createCreditNote(buildCreatePayload(form, facts, credits.credited));
    } catch (e) {
      setBusy(null);
      if (errorKind(e) === 'conflict') setConflict(true);
      else setError(errorText(e));
      return;
    }
    if (thenIssue) {
      try {
        saved = await invoicingApi.issueCreditNote(saved.id, saved.rowVersion);
        toast(t('issuedToast', { number: saved.number ?? '' }), 'success');
      } catch (e) {
        // The draft is saved; the person finishes on its page, where the reason is shown.
        await invalidateInvoicing(qc);
        toast(t('savedNotIssued', { reason: errorText(e) }), 'danger');
        router.push(creditNoteHref(saved.id));
        return;
      }
    } else toast(t('savedToast'), 'success');
    await invalidateInvoicing(qc);
    router.push(creditNoteHref(saved.id));
  }

  const settlementOptions: Record<CreditNoteSettlement, string> = {
    balance: t('settlement.balance.title'),
    refund: t('settlement.refund.title'),
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={note ? creditNoteHref(note.id) : '/credit-notes'}
            aria-label={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BackIcon className="size-4 rtl:rotate-180" />
          </Link>
          <h1 className="min-w-0 truncate text-xl font-bold tracking-tight">
            {note ? t('editTitle') : t('newTitle')}
          </h1>
        </div>
      </header>

      {conflict && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('conflict')}</span>
          <Button variant="secondary" size="sm" onClick={onReload} type="button">
            {t('reload')}
          </Button>
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Card title={t('invoice.title')} hint={t('invoice.hint')}>
            <CreditInvoicePicker
              invoiceId={form.invoiceId}
              invoice={invoice.data}
              loading={invoice.isPending && form.invoiceId !== null}
              error={invoice.error}
              locked={note !== null}
              invalid={!!shown.invoice}
              onPick={pickInvoice}
              onClear={() =>
                setForm((f) => ({
                  ...emptyForm(null),
                  reason: f.reason,
                  note: f.note,
                  settlement: f.settlement,
                  issueDate: f.issueDate,
                }))
              }
            />
            {shown.invoice && (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {tp(shown.invoice)}
              </p>
            )}
            {invoice.data && !creditable && (
              <div className="mt-3">
                <NotCreditableAlert />
              </div>
            )}
          </Card>

          <Card title={t('details.title')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('details.reason')} htmlFor="cn-reason">
                <Select
                  id="cn-reason"
                  value={form.reason}
                  onChange={(e) => patch({ reason: e.target.value as CreditForm['reason'] })}
                >
                  {CREDIT_REASON_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('details.issueDate')}
                htmlFor="cn-date"
                hint={t('details.issueDateHint', { today })}
              >
                <Input
                  id="cn-date"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => patch({ issueDate: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label={t('details.note')}
              htmlFor="cn-note"
              hint={t('details.noteHint')}
              error={shown.note ? tp(shown.note) : undefined}
              className="mt-4"
            >
              <Textarea
                id="cn-note"
                rows={3}
                maxLength={2000}
                dir="auto"
                value={form.note}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </Field>
          </Card>

          <Card title={t('settlement.title')} hint={t('settlement.hint')}>
            <div
              role="radiogroup"
              aria-label={t('settlement.title')}
              className="grid gap-3 sm:grid-cols-2"
            >
              {CREDIT_NOTE_SETTLEMENTS.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-primary',
                    form.settlement === s
                      ? 'border-brand bg-brand/5'
                      : 'border-border hover:bg-muted/50',
                  )}
                >
                  <input
                    type="radio"
                    name="settlement"
                    value={s}
                    checked={form.settlement === s}
                    onChange={() => patch({ settlement: s })}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{settlementOptions[s]}</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {t(`settlement.${s}.body`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          <Card title={t('what.title')}>
            {!facts ? (
              <p className="text-sm text-muted-foreground">{t('what.pickFirst')}</p>
            ) : (
              <div className="space-y-4">
                <div
                  role="radiogroup"
                  aria-label={t('what.title')}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {(['full', 'lines'] as const).map((m) => (
                    <label
                      key={m}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-primary',
                        form.mode === m
                          ? 'border-brand bg-brand/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={form.mode === m}
                        onChange={() => patch({ mode: m })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t(`what.${m}.title`)}</span>
                        <span className="mt-0.5 block text-muted-foreground">
                          {m === 'full' ? (
                            <>
                              {t('what.full.body')}{' '}
                              <Money minor={num(facts.creditableMinor)} currency={facts.currency} />
                            </>
                          ) : (
                            t('what.lines.body')
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {credits.isPending ? (
                  <div
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Spinner /> {t('what.loadingCredits')}
                  </div>
                ) : credits.error ? (
                  <ErrorLine error={credits.error} onRetry={credits.refetch} />
                ) : form.mode === 'lines' ? (
                  <CreditLinesPicker
                    form={form}
                    invoice={facts}
                    credited={credits.credited}
                    taxRates={taxRates}
                    problems={shown}
                    onChange={patch}
                  />
                ) : null}
                {shown.lines && (
                  <p role="alert" className="text-sm text-danger">
                    {tp(shown.lines)}
                  </p>
                )}
              </div>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy !== null} className="h-11 min-w-32">
              {busy === 'save' && <Spinner />}
              {t('saveDraft')}
            </Button>
            {can.issueCreditNote && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void save(true)}
                className="h-11"
              >
                {busy === 'issue' && <Spinner />}
                {t('saveAndIssue')}
              </Button>
            )}
            <Link
              href={note ? creditNoteHref(note.id) : '/credit-notes'}
              className="inline-flex h-11 items-center rounded-md px-4 text-sm font-medium hover:bg-muted"
            >
              {t('cancel')}
            </Link>
          </div>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-4">
          {facts && estimate && invoice.data ? (
            <CreditEstimate
              estimate={estimate}
              currency={facts.currency}
              settlement={form.settlement}
              totalMinor={BigInt(invoice.data.amountsMinor.total)}
              creditedMinor={BigInt(invoice.data.amountsMinor.credited)}
              paidMinor={BigInt(invoice.data.amountsMinor.paid)}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {t('estimateWaiting')}
            </p>
          )}
        </aside>
      </div>
    </form>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-muted-foreground">{hint}</p>}
      <div className={hint ? undefined : 'mt-3'}>{children}</div>
    </section>
  );
}
