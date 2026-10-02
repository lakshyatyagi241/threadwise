'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useId, useState, type ReactNode } from 'react';
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  MenuItem,
  MenuSeparator,
  Modal,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import type { DocRow, SalesDoc } from '../api/schemas';
import { newSalesOrderHref } from '@/features/invoicing';
import { salesDocsApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { addDays } from '../lib/builder';
import { docHref, type SalesDocKind } from '../lib/kinds';
import type { DocAction } from '../lib/status';
import {
  CalendarIcon,
  CheckIcon,
  CopyDocIcon,
  CopyIcon,
  DealIcon,
  EyeIcon,
  HistoryIcon,
  InvoiceIcon,
  PencilIcon,
  PrintIcon,
  SendIcon,
  TrashIcon,
  UndoIcon,
  XIcon,
} from './icons';
import { useErrorText, useToday } from './parts';
import { SendDialog } from './send-dialog';
import { useDocActions } from './use-doc-actions';

/** Actions that ask first: they change what the buyer sees, record an answer for them, or cannot be undone. */
const CONFIRMED = ['markSent', 'revise', 'convertInvoice', 'convertDeal', 'delete'] as const;
/** Actions that also take a note or a date. */
const FORMS = ['accept', 'decline', 'extend'] as const;
type Confirmed = (typeof CONFIRMED)[number];
type FormAction = (typeof FORMS)[number];
const isConfirmed = (a: DocAction): a is Confirmed => (CONFIRMED as readonly string[]).includes(a);
const isForm = (a: DocAction): a is FormAction => (FORMS as readonly string[]).includes(a);

export interface DocControllerOptions {
  kind: SalesDocKind;
  /** The activity drawer for a document (the screen owns it). */
  onActivity?: (doc: DocRow) => void;
  /** Print the document (only the screen that has the paper on it can). */
  onPrint?: (doc: DocRow) => void;
  /** A document was deleted here; the screen leaves it (closes its page, or just refreshes). */
  onDeleted?: (doc: DocRow) => void;
  /** A document changed here (status, link, send); the screen may refresh what it shows. */
  onChanged?: (doc: SalesDoc) => void;
  /** Where "duplicate" goes: the new draft's page (default), or stay. */
  onDuplicated?: (doc: SalesDoc) => void;
}

/**
 * Runs the actions of a document for the list's row menu and the document page alike: the confirm step, the send dialog, the
 * toasts and the navigation after a duplicate. `node` holds the dialogs; render it once next to the screen.
 */
export function useDocController(o: DocControllerOptions) {
  const t = useTranslations('sales-docs.confirm');
  const tk = useTranslations('sales-docs.kind');
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const actions = useDocActions();
  const [confirm, setConfirm] = useState<{ action: Confirmed; doc: DocRow } | null>(null);
  const [form, setForm] = useState<{ action: FormAction; doc: DocRow } | null>(null);
  const [sendFor, setSendFor] = useState<SalesDoc | null>(null);
  const [busy, setBusy] = useState(false);

  const kindWord = (doc: DocRow) => tk(`${doc.kind}.singular`).toLowerCase();

  /** The full document: a row from the list has no buyer details or link yet. */
  async function full(doc: DocRow | SalesDoc): Promise<SalesDoc | null> {
    if ('items' in doc) return doc;
    try {
      return await salesDocsApi.get(doc.id);
    } catch (e) {
      toast(errorText(e), 'danger');
      return null;
    }
  }

  async function copyLink(doc: DocRow) {
    try {
      const link = await salesDocsApi.link(doc.id);
      await navigator.clipboard.writeText(link.url);
      toast(link.active ? t('linkCopied') : t('linkCopiedInactive'), 'success');
    } catch (e) {
      toast(errorKind(e) === 'network' ? t('copyFailed') : errorText(e), 'danger');
    }
  }

  async function finish(result: SalesDoc | boolean | null, doc: DocRow, deleted: boolean) {
    if (!result) return false;
    if (deleted) o.onDeleted?.(doc);
    else if (typeof result === 'object') o.onChanged?.(result);
    return true;
  }

  async function perform(action: Confirmed, doc: DocRow) {
    setBusy(true);
    try {
      let result: SalesDoc | boolean | null;
      if (action === 'delete') result = await actions.remove(doc);
      else if (action === 'convertInvoice') result = await actions.convertInvoice(doc);
      else if (action === 'convertDeal') result = (await actions.convertDeal(doc))?.doc ?? null;
      else if (action === 'revise') result = await actions.revise(doc);
      else result = (await actions.send(doc, { channel: 'link' }))?.doc ?? null;
      if (await finish(result, doc, action === 'delete')) setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(value: string) {
    if (!form) return;
    setBusy(true);
    try {
      const { action, doc } = form;
      const result =
        action === 'accept'
          ? await actions.accept(doc, value || undefined)
          : action === 'decline'
            ? await actions.decline(doc, value || undefined)
            : await actions.extend(doc, value);
      if (await finish(result, doc, false)) setForm(null);
    } finally {
      setBusy(false);
    }
  }

  function run(action: DocAction, doc: DocRow | SalesDoc) {
    if (isConfirmed(action)) return setConfirm({ action, doc });
    if (isForm(action)) return setForm({ action, doc });
    switch (action) {
      case 'edit':
        return router.push(docHref(doc.kind, doc.id));
      case 'send':
        return void full(doc).then((d) => d && setSendFor(d));
      case 'createSalesOrder':
        return router.push(newSalesOrderHref({ quote: doc.id }));
      case 'copyLink':
        return void copyLink(doc);
      case 'activity':
        return o.onActivity?.(doc);
      case 'print':
        return o.onPrint?.(doc);
      case 'duplicate':
        return void actions.duplicate(doc).then((copy) => {
          if (!copy) return;
          o.onChanged?.(copy);
          if (o.onDuplicated) o.onDuplicated(copy);
          else router.push(docHref(copy.kind, copy.id));
        });
    }
  }

  const node: ReactNode = (
    <>
      <ConfirmDialog
        open={confirm !== null}
        tone={confirm?.action === 'delete' ? 'danger' : 'default'}
        busy={busy}
        title={
          confirm
            ? t(`${confirm.action}.title`, {
                number: confirm.doc.number,
                kind: kindWord(confirm.doc),
              })
            : ''
        }
        message={
          confirm
            ? t(`${confirm.action}.message`, {
                number: confirm.doc.number,
                kind: kindWord(confirm.doc),
              })
            : ''
        }
        confirmLabel={confirm ? t(`${confirm.action}.confirm`) : ''}
        cancelLabel={t('cancel')}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void perform(confirm.action, confirm.doc)}
      />
      <FormDialog
        // a fresh form for every opening
        key={form ? `${form.action}:${form.doc.id}` : 'closed'}
        form={form}
        busy={busy}
        kindWord={form ? kindWord(form.doc) : ''}
        onClose={() => setForm(null)}
        onSubmit={(v) => void submitForm(v)}
      />
      <SendDialog
        doc={sendFor}
        busy={busy}
        onClose={() => setSendFor(null)}
        onSend={async (doc, input) => {
          setBusy(true);
          try {
            const result = await actions.send(doc, input);
            if (result) {
              o.onChanged?.(result.doc);
              // the dialog stays on the link tab; a real send (email, WhatsApp) closes it
              setSendFor(input.channel === 'link' ? result.doc : null);
            }
            return result;
          } finally {
            setBusy(false);
          }
        }}
        onChanged={(d) => {
          setSendFor(d);
          o.onChanged?.(d);
        }}
      />
    </>
  );

  return { run, node, busy };
}

/** Accept, decline (an optional note) and extend (a date): the three that need one more value than a yes. */
function FormDialog({
  form,
  busy,
  kindWord,
  onClose,
  onSubmit,
}: {
  form: { action: FormAction; doc: DocRow } | null;
  busy: boolean;
  kindWord: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const t = useTranslations('sales-docs.confirm');
  const today = useToday();
  const base = useId();
  const action = form?.action ?? 'accept';
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => addDays(today, 14));
  const dateBad = action === 'extend' && date < today;

  return (
    <Modal
      open={form !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={form ? t(`${action}.title`, { number: form.doc.number, kind: kindWord }) : ''}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant={action === 'decline' ? 'danger' : 'primary'}
            disabled={busy || !date || dateBad}
            onClick={() => onSubmit(action === 'extend' ? date : note.trim())}
          >
            {busy && <Spinner />} {t(`${action}.confirm`)}
          </Button>
        </>
      }
    >
      {form && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(`${action}.message`, {
              number: form.doc.number,
              kind: kindWord,
              name: form.doc.buyerName || form.doc.contact?.name || t('theBuyer'),
            })}
          </p>
          {action === 'extend' ? (
            <Field
              label={t('extend.date')}
              htmlFor={`${base}-date`}
              error={dateBad ? t('extend.past') : undefined}
            >
              <Input
                id={`${base}-date`}
                type="date"
                value={date}
                invalid={dateBad}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto"
              />
            </Field>
          ) : (
            <Field label={t('note')} htmlFor={`${base}-note`} hint={t('noteHint')}>
              <Textarea
                id={`${base}-note`}
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                dir="auto"
              />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

const ICON: Record<DocAction, typeof SendIcon> = {
  edit: PencilIcon,
  send: SendIcon,
  markSent: CheckIcon,
  accept: CheckIcon,
  decline: XIcon,
  revise: UndoIcon,
  extend: CalendarIcon,
  convertInvoice: InvoiceIcon,
  createSalesOrder: InvoiceIcon,
  convertDeal: DealIcon,
  duplicate: CopyDocIcon,
  delete: TrashIcon,
  print: PrintIcon,
  copyLink: CopyIcon,
  activity: HistoryIcon,
};

/** The order the actions are listed in a menu, with a rule between groups. */
const GROUPS: DocAction[][] = [
  ['send', 'copyLink', 'markSent'],
  ['accept', 'decline', 'revise', 'extend'],
  ['convertInvoice', 'createSalesOrder', 'convertDeal'],
  ['duplicate', 'print', 'activity'],
  ['delete'],
];

/** Menu items for a document's allowed actions (row menu, the document page's "More"). `skip` leaves some out. */
export function DocMenuItems({
  allowed,
  onRun,
  close,
  onOpen,
  skip = [],
}: {
  allowed: ReadonlySet<DocAction>;
  onRun: (a: DocAction) => void;
  close: () => void;
  /** Adds an "Open" item at the top (the list's rows). */
  onOpen?: () => void;
  skip?: readonly DocAction[];
}) {
  const t = useTranslations('sales-docs.actions');
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const groups = GROUPS.map((g) => g.filter((a) => allowed.has(a) && !skip.includes(a))).filter(
    (g) => g.length,
  );
  return (
    <>
      {onOpen && (
        <MenuItem onSelect={run(onOpen)}>
          <EyeIcon /> {t('open')}
        </MenuItem>
      )}
      {groups.map((g, i) => (
        <Fragment key={g[0]}>
          {(i > 0 || onOpen) && <MenuSeparator />}
          {g.map((a) => {
            const Icon = ICON[a];
            return (
              <MenuItem
                key={a}
                danger={a === 'delete' || a === 'decline'}
                onSelect={run(() => onRun(a))}
              >
                <Icon /> {t(a)}
              </MenuItem>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
