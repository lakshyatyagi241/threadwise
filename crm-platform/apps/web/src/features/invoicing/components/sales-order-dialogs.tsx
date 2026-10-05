'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { parseMajor, type SalesOrderResponse, type SalesOrderSummary } from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@crm/ui';
import { errorCode } from '../lib/errors';
import {
  buildFulfilPayload,
  buildInvoicePayload,
  defaultQty,
  emptyFulfilForm,
  emptyInvoiceForm,
  fulfilFormProblems,
  hasInvoiceProblems,
  invoiceFormProblems,
  invoiceTarget,
  lineFacts,
  qtyText,
  FULFIL_NOTE_MAX,
  type FulfilForm,
  type InvoiceForm,
  type LineQtyProblems,
} from '../lib/sales-orders';
import { Money, ErrorLine, useToday } from './parts';
import { salesOrderHref, useSalesOrderActions } from './sales-order-parts';

type OrderLine = SalesOrderResponse['lines'][number];
/** A list row has no lines; the detail passes the whole order. */
export type DialogOrder = SalesOrderSummary | SalesOrderResponse;
export type SalesOrderDialogKind = 'confirm' | 'invoice' | 'fulfil' | 'cancel' | 'delete';

const hasLines = (o: DialogOrder): o is SalesOrderResponse => 'lines' in o;

export const CANCEL_REASON_MAX = 500;
const TERMS = ['0', '7', '14', '15', '30', '45', '60'] as const;

/** Opens one of the order dialogs; `node` goes once at the end of the screen. `onDone` runs after a successful action. */
export function useSalesOrderDialogs(onDone?: (kind: SalesOrderDialogKind) => void) {
  const [state, setState] = useState<{ kind: SalesOrderDialogKind; order: DialogOrder } | null>(
    null,
  );
  const close = () => setState(null);
  const done = () => {
    const kind = state?.kind;
    close();
    if (kind) onDone?.(kind);
  };
  const node = state ? (
    state.kind === 'confirm' ? (
      <ConfirmOrderDialog order={state.order} onClose={close} onDone={done} />
    ) : state.kind === 'invoice' ? (
      <InvoiceDialog order={state.order} onClose={close} />
    ) : state.kind === 'fulfil' ? (
      <FulfilDialog order={state.order} onClose={close} onDone={done} />
    ) : state.kind === 'cancel' ? (
      <CancelDialog order={state.order} onClose={close} onDone={done} />
    ) : (
      <DeleteDialog order={state.order} onClose={close} onDone={done} />
    )
  ) : null;
  return {
    open: (kind: SalesOrderDialogKind, order: DialogOrder) => setState({ kind, order }),
    node,
  };
}

/** The shell every dialog uses: the title, the order number as the kicker, the body and the two buttons. */
function Shell({
  order,
  title,
  size = 'sm',
  busy,
  onClose,
  onSubmit,
  confirmLabel,
  confirmVariant = 'brand',
  children,
  disabled,
}: {
  order: DialogOrder;
  title: string;
  size?: 'sm' | 'md';
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
  confirmLabel: string;
  confirmVariant?: 'brand' | 'danger' | 'primary';
  children: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations('invoicing.salesOrders.dialog');
  return (
    <Modal
      open
      size={size}
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={<span dir="ltr">{order.number}</span>}
      title={title}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant={confirmVariant} onClick={onSubmit} disabled={busy || disabled}>
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        {/* Enter submits from a text box without a visible submit button of its own. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// --- confirm ---------------------------------------------------------------------------------------------------------------------

function ConfirmOrderDialog({
  order,
  onClose,
  onDone,
}: {
  order: DialogOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('invoicing.salesOrders.confirmDialog');
  const actions = useSalesOrderActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    const r = await actions.confirm(order.id, { quiet: true });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  }
  return (
    <Shell
      order={order}
      title={t('title')}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      confirmLabel={t('confirm')}
    >
      <p className="text-sm text-muted-foreground">{t('message')}</p>
      {error !== null && <ErrorLine error={error} />}
    </Shell>
  );
}

// --- cancel ----------------------------------------------------------------------------------------------------------------------

function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: DialogOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('invoicing.salesOrders.cancelDialog');
  const actions = useSalesOrderActions();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    const text = reason.trim();
    if (!text) return setProblem(t('reasonRequired'));
    if (text.length > CANCEL_REASON_MAX)
      return setProblem(t('reasonTooLong', { max: CANCEL_REASON_MAX }));
    setProblem(undefined);
    setBusy(true);
    setError(null);
    const r = await actions.cancel(order.id, { reason: text }, { quiet: true });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  }
  const hasInvoices = errorCode(error) === 'SO_HAS_INVOICES';
  return (
    <Shell
      order={order}
      title={t('title')}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      confirmLabel={t('cancelOrder')}
      confirmVariant="danger"
    >
      <Alert tone="warning">{t('warning')}</Alert>
      <Field label={t('reason')} htmlFor="so-cancel-reason" error={problem} hint={t('reasonHint')}>
        <Textarea
          id="so-cancel-reason"
          rows={3}
          dir="auto"
          autoFocus
          maxLength={CANCEL_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {error !== null && <ErrorLine error={error} />}
      {hasInvoices && (
        <Alert tone="info">
          <p>{t('hasInvoices')}</p>
          <Link
            href={salesOrderHref(order.id)}
            className="mt-1 inline-block font-medium underline underline-offset-2"
            onClick={onClose}
          >
            {t('seeInvoices')}
          </Link>
        </Alert>
      )}
    </Shell>
  );
}

// --- delete ----------------------------------------------------------------------------------------------------------------------

function DeleteDialog({
  order,
  onClose,
  onDone,
}: {
  order: DialogOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('invoicing.salesOrders.deleteDialog');
  const actions = useSalesOrderActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    const r = await actions.remove(order.id, { quiet: true });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  }
  return (
    <Shell
      order={order}
      title={t('title')}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      confirmLabel={t('delete')}
      confirmVariant="danger"
    >
      <p className="text-sm text-muted-foreground">{t('message')}</p>
      {error !== null && <ErrorLine error={error} />}
    </Shell>
  );
}

// --- per-line quantities ---------------------------------------------------------------------------------------------------------

/** The "choose quantities" list: each line with what is left and a box that defaults to all of it and never exceeds it. */
function QtyLines({
  lines,
  kind,
  qty,
  problems,
  onChange,
  disabled,
}: {
  lines: readonly OrderLine[];
  kind: 'invoice' | 'fulfil';
  qty: Record<string, string>;
  problems: LineQtyProblems['lines'];
  onChange: (lineId: string, value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('invoicing.salesOrders.dialog');
  const open = lines.filter(
    (l) => (kind === 'invoice' ? lineFacts(l).toInvoice : lineFacts(l).toFulfil) > 0n,
  );
  return (
    <ul className="thin-scrollbar max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
      {open.map((l) => {
        const left = kind === 'invoice' ? lineFacts(l).toInvoice : lineFacts(l).toFulfil;
        const id = `so-qty-${kind}-${l.id}`;
        const problem = problems[l.id];
        return (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-40">
              <label
                htmlFor={id}
                className="block truncate text-sm font-medium"
                dir="auto"
                title={l.description}
              >
                {l.description}
              </label>
              <span className="text-xs text-muted-foreground">
                {t('left', { qty: qtyText(left) })}
              </span>
            </div>
            <Input
              id={id}
              inputMode="decimal"
              dir="ltr"
              disabled={disabled}
              value={qty[l.id] ?? defaultQty(l, kind)}
              invalid={!!problem}
              aria-describedby={problem ? `${id}-err` : undefined}
              onChange={(e) => onChange(l.id, e.target.value)}
              className="w-28 text-end"
            />
            {problem && (
              <p id={`${id}-err`} role="alert" className="basis-full text-xs text-danger">
                {problem === 'qtyExceeds'
                  ? t('qtyExceeds', { max: qtyText(left) })
                  : t('qtyInvalid')}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ModeChoice({
  mode,
  onChange,
  disabled,
}: {
  mode: 'all' | 'lines';
  onChange: (m: 'all' | 'lines') => void;
  disabled?: boolean;
}) {
  const t = useTranslations('invoicing.salesOrders.dialog');
  return (
    <div role="radiogroup" aria-label={t('how')} className="grid gap-2 sm:grid-cols-2">
      {(['all', 'lines'] as const).map((m) => (
        <label
          key={m}
          className={cn(
            'flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
            mode === m ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:bg-muted',
          )}
        >
          <input
            type="radio"
            name="so-qty-mode"
            checked={mode === m}
            disabled={disabled}
            onChange={() => onChange(m)}
            className="size-4 accent-[var(--primary)]"
          />
          {t(`mode.${m}`)}
        </label>
      ))}
    </div>
  );
}

// --- invoice ---------------------------------------------------------------------------------------------------------------------

/**
 * "Invoice...": bill everything still unbilled, or name quantities per line (each defaults to what is left and cannot exceed it).
 * The invoice is a draft unless "issue now" is ticked; shipping goes on the first invoice. A list row has no lines, so it only
 * offers "everything left". On success the person lands on the new invoice (a draft opens for editing).
 */
function InvoiceDialog({ order, onClose }: { order: DialogOrder; onClose: () => void }) {
  const t = useTranslations('invoicing.salesOrders.invoiceDialog');
  const td = useTranslations('invoicing.salesOrders.dialog');
  const router = useRouter();
  const today = useToday();
  const actions = useSalesOrderActions();
  const lines = hasLines(order) ? order.lines : null;
  const shippingMinor = hasLines(order)
    ? (parseMajor(order.amounts.shipping, order.currency) ?? 0n)
    : 0n;
  const shippingPending = hasLines(order) ? shippingMinor > 0n && !order.shippingInvoiced : false;
  const [form, setForm] = useState<InvoiceForm>(() => emptyInvoiceForm(shippingPending));
  const [shown, setShown] = useState<LineQtyProblems>({ lines: {}, form: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<InvoiceForm>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    const p = lines ? invoiceFormProblems(form, lines) : { lines: {}, form: [] };
    setShown(p);
    if (hasInvoiceProblems(p)) return;
    setBusy(true);
    setError(null);
    const body = lines
      ? buildInvoicePayload(form, lines, { shippingPending })
      : { all: true as const, issue: form.issue, includeShipping: true };
    const r = await actions.invoice(order.id, body, { quiet: true });
    setBusy(false);
    if (r.ok) {
      onClose();
      router.push(invoiceTarget(r.value.invoice));
    } else setError(r.error);
  }

  const err = (k: string) => (shown.form.includes(k as never) ? t(`problems.${k}`) : undefined);
  return (
    <Shell
      order={order}
      size="md"
      title={t('title')}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      confirmLabel={form.issue ? t('invoiceAndIssue') : t('createDraft')}
    >
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {lines && <ModeChoice mode={form.mode} onChange={(mode) => set({ mode })} disabled={busy} />}
      {lines && form.mode === 'lines' && (
        <QtyLines
          lines={lines}
          kind="invoice"
          qty={form.qty}
          problems={shown.lines}
          disabled={busy}
          onChange={(id, v) => set({ qty: { ...form.qty, [id]: v } })}
        />
      )}
      {err('nothing') && (
        <p role="alert" className="text-xs text-danger">
          {err('nothing')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={t('issueDate')}
          htmlFor="so-inv-issue"
          error={err('issueDateInvalid')}
          hint={t('issueDateHint', { today })}
        >
          <Input
            id="so-inv-issue"
            type="date"
            dir="ltr"
            disabled={busy}
            value={form.issueDate}
            invalid={!!err('issueDateInvalid')}
            onChange={(e) => set({ issueDate: e.target.value })}
          />
        </Field>
        <Field
          label={t('dueDate')}
          htmlFor="so-inv-due"
          error={err('dueDateInvalid') ?? err('dueBeforeIssue')}
        >
          <Input
            id="so-inv-due"
            type="date"
            dir="ltr"
            disabled={busy}
            value={form.dueDate}
            invalid={!!(err('dueDateInvalid') ?? err('dueBeforeIssue'))}
            onChange={(e) => set({ dueDate: e.target.value })}
          />
        </Field>
        <Field label={t('terms')} htmlFor="so-inv-terms">
          <Select
            id="so-inv-terms"
            disabled={busy || form.dueDate !== ''}
            value={form.termsDays}
            onChange={(e) => set({ termsDays: e.target.value })}
          >
            <option value="">{t('termsDefault')}</option>
            {TERMS.map((d) => (
              <option key={d} value={d}>
                {d === '0' ? t('termsOnIssue') : t('termsDays', { count: Number(d) })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <Checkbox
          id="so-inv-issue-now"
          checked={form.issue}
          disabled={busy}
          onChange={(e) => set({ issue: e.target.checked })}
          label={t('issueNow')}
        />
        <p className="ps-6 text-xs text-muted-foreground">
          {form.issue ? t('issueNowHint') : t('draftHint')}
        </p>
        {shippingPending && hasLines(order) && (
          <Checkbox
            id="so-inv-ship"
            checked={form.includeShipping}
            disabled={busy}
            onChange={(e) => set({ includeShipping: e.target.checked })}
            label={
              <span>
                {t('includeShipping')}{' '}
                <Money
                  minor={Number(shippingMinor)}
                  currency={order.currency}
                  className="font-medium"
                />
              </span>
            }
          />
        )}
      </div>
      {error !== null && <ErrorLine error={error} />}
      {errorCode(error) === 'SO_NOTHING_TO_INVOICE' && (
        <Alert tone="info">{td('nothingHint')}</Alert>
      )}
    </Shell>
  );
}

// --- fulfil ----------------------------------------------------------------------------------------------------------------------

/** "Record delivery": everything left, or quantities per line (never above what was ordered), with an optional note. */
function FulfilDialog({
  order,
  onClose,
  onDone,
}: {
  order: DialogOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('invoicing.salesOrders.fulfilDialog');
  const actions = useSalesOrderActions();
  const lines = hasLines(order) ? order.lines : null;
  const [form, setForm] = useState<FulfilForm>(emptyFulfilForm);
  const [shown, setShown] = useState<LineQtyProblems>({ lines: {}, form: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<FulfilForm>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    const p = lines ? fulfilFormProblems(form, lines) : { lines: {}, form: [] };
    setShown(p);
    if (p.form.length > 0 || Object.keys(p.lines).length > 0) return;
    setBusy(true);
    setError(null);
    const body = lines
      ? buildFulfilPayload(form, lines)
      : { all: true as const, ...(form.note.trim() ? { note: form.note.trim() } : {}) };
    const r = await actions.fulfil(order.id, body, { quiet: true });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  }
  return (
    <Shell
      order={order}
      size="md"
      title={t('title')}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
      confirmLabel={t('record')}
    >
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {lines && <ModeChoice mode={form.mode} onChange={(mode) => set({ mode })} disabled={busy} />}
      {lines && form.mode === 'lines' && (
        <QtyLines
          lines={lines}
          kind="fulfil"
          qty={form.qty}
          problems={shown.lines}
          disabled={busy}
          onChange={(id, v) => set({ qty: { ...form.qty, [id]: v } })}
        />
      )}
      {shown.form.includes('nothing') && (
        <p role="alert" className="text-xs text-danger">
          {t('problems.nothing')}
        </p>
      )}
      <Field
        label={t('note')}
        htmlFor="so-fulfil-note"
        hint={t('noteHint')}
        error={
          shown.form.includes('noteTooLong')
            ? t('problems.noteTooLong', { max: FULFIL_NOTE_MAX })
            : undefined
        }
      >
        <Textarea
          id="so-fulfil-note"
          rows={2}
          dir="auto"
          disabled={busy}
          maxLength={FULFIL_NOTE_MAX + 50}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </Field>
      {error !== null && <ErrorLine error={error} />}
    </Shell>
  );
}
