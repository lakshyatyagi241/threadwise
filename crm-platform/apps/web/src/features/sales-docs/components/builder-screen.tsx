'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Menu,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useUnsavedGuard } from '@/features/segments/components/use-unsaved-guard';
import { useDoc } from '../api/hooks';
import type { DocRow, Ref, SalesDoc } from '../api/schemas';
import { salesDocsApi } from '../api/service';
import {
  NOTES_MAX,
  TERMS_MAX,
  TITLE_MAX,
  addDays,
  draftFromDoc,
  draftToInput,
  draftTotals,
  emptyDraft,
  hasErrors,
  isDirty,
  newKey,
  validateDraft,
  type Draft,
} from '../lib/builder';
import { isUnavailable } from '../lib/errors';
import { builderHotkey } from '../lib/hotkeys';
import { docHref, KIND_META, type SalesDocKind } from '../lib/kinds';
import { formatMoney, minorToInput } from '../lib/money';
import { paperFromDraft } from '../lib/paper';
import { allowedActions, effectiveStatus } from '../lib/status';
import { appendTemplate, currencyChoices, NOTE_TEMPLATES, TERMS_TEMPLATES } from '../lib/templates';
import { ActivityDrawer } from './activity-drawer';
import { DocMenuItems, useDocController } from './doc-controller';
import { DocumentPaper, PrintSheet, printDocument } from './document-paper';
import {
  ChevronLeftIcon,
  EstimateIcon,
  InvoiceIcon,
  MoreIcon,
  PrintIcon,
  ProposalIcon,
  SendIcon,
} from './icons';
import { LineItemsEditor } from './line-items-editor';
import { ErrorLine, StatusChip, useSalesDocsCan, useToday, useWorkspaceZone } from './parts';
import { RecordPicker } from './record-picker';
import { useDocActions } from './use-doc-actions';
import { useLocale } from 'next-intl';
import { newSalesOrderHref } from '@/features/invoicing';

/** A titled card of the form. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * `/proposals/new`, `/proposals/<id>` and the same for estimates: the document builder. A draft is edited in the form on one
 * side while the sheet on the other side shows what the buyer will receive, drawn from the same model with the same money
 * rule, so the figures never differ from the saved ones. A document that has been sent is shown read-only (its terms are what
 * the buyer saw); "Duplicate" makes an editable copy.
 */
export function BuilderScreen({ kind, docId }: { kind: SalesDocKind; docId?: string }) {
  const search = useSearchParams();
  const existing = useDoc(docId ?? null);
  const t = useTranslations('sales-docs.builder');

  if (docId) {
    if (existing.isPending) return <PageLoading />;
    if (existing.isError) {
      return (
        <div className="space-y-3">
          <BackLink kind={kind} />
          {isUnavailable(existing.error) ||
          (existing.error as { status?: number }).status === 404 ? (
            <EmptyState title={t('notFoundTitle')} message={t('notFound')} />
          ) : (
            <ErrorLine error={existing.error} onRetry={() => void existing.refetch()} />
          )}
        </div>
      );
    }
    return <BuilderForm key={existing.data.id} kind={existing.data.kind} doc={existing.data} />;
  }
  return (
    <BuilderForm
      kind={kind}
      doc={null}
      link={{ contact: search.get('contact') ?? '', deal: search.get('deal') ?? '' }}
    />
  );
}

function PageLoading() {
  const t = useTranslations('sales-docs.builder');
  return (
    <div role="status" className="flex items-center gap-2 py-16 text-muted-foreground">
      <Spinner /> {t('loading')}
    </div>
  );
}

function BackLink({ kind }: { kind: SalesDocKind }) {
  const t = useTranslations('sales-docs.builder');
  return (
    <Link
      href={KIND_META[kind].base}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeftIcon className="size-3.5 rtl:rotate-180" /> {t(`back.${kind}`)}
    </Link>
  );
}

function BuilderForm({
  kind,
  doc,
  link,
}: {
  kind: SalesDocKind;
  doc: SalesDoc | null;
  link?: { contact: string; deal: string };
}) {
  const t = useTranslations('sales-docs.builder');
  const tt = useTranslations('sales-docs.templates');
  const tk = useTranslations('sales-docs.kind');
  const ta = useTranslations('sales-docs.actions');
  const te = useTranslations('sales-docs.builder.problems');
  const locale = useLocale();
  const router = useRouter();
  const session = useSession();
  const can = useSalesDocsCan();
  const actions = useDocActions();
  const today = useToday();
  const zone = useWorkspaceZone();
  const base = useId();

  const orgCurrency = (session.org.currency ?? 'USD').toUpperCase();
  const initial = useMemo(
    () => (doc ? draftFromDoc(doc) : emptyDraft(orgCurrency)),
    [doc, orgCurrency],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<Draft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [activityFor, setActivityFor] = useState<DocRow | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [liveDoc, setLiveDoc] = useState<SalesDoc | null>(doc);
  const current = liveDoc ?? doc;

  // A new document opened from a contact or a deal starts linked to it.
  const linkedOnce = useRef(false);
  useEffect(() => {
    if (doc || !link || linkedOnce.current) return;
    linkedOnce.current = true;
    void (async () => {
      try {
        if (link.deal) {
          const d = await salesDocsApi.dealById(link.deal);
          setDraft((cur) => ({ ...cur, deal: { id: d.id, name: d.title } }));
          setSaved((cur) => ({ ...cur, deal: { id: d.id, name: d.title } }));
          if (d.contact && !link.contact) {
            const c = await salesDocsApi.contactById(d.contact.id);
            fillContact({ id: c.id, name: c.name ?? '' }, c.email ?? '', c.phone ?? '', true);
          }
        }
        if (link.contact) {
          const c = await salesDocsApi.contactById(link.contact);
          const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ');
          fillContact({ id: c.id, name }, c.email ?? '', c.phone ?? '', true);
        }
      } catch {
        /* the link is a convenience: the form works without it */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fillContact(ref: Ref | null, email: string, phone: string, alsoSaved = false) {
    const patch = (d: Draft): Draft => ({
      ...d,
      contact: ref,
      ...(ref
        ? {
            buyerName: d.buyerName.trim() ? d.buyerName : ref.name,
            buyerEmail: d.buyerEmail.trim() ? d.buyerEmail : email,
            buyerPhone: d.buyerPhone.trim() ? d.buyerPhone : phone,
          }
        : {}),
    });
    setDraft(patch);
    if (alsoSaved) setSaved(patch);
  }

  const status = current ? effectiveStatus(current, today) : 'draft';
  const editable = !current || current.actions.edit;
  const dirty = isDirty(draft, saved);
  const totals = useMemo(() => draftTotals(draft), [draft]);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const paper = useMemo(
    () =>
      paperFromDraft(draft, {
        kind,
        number: current?.number ?? '',
        status,
        seller: { name: session.org.name, logoUrl: null, address: '', taxId: '' },
        issuedAt: current?.sentAt ?? current?.createdAt ?? new Date().toISOString(),
      }),
    [draft, kind, current, status, session.org.name],
  );

  const controller = useDocController({
    kind,
    onActivity: (d) => setActivityFor(d),
    onPrint: () => printDocument(),
    onDeleted: () => router.replace(KIND_META[kind].base),
    onChanged: (d) => setLiveDoc(d),
    onDuplicated: (copy) => router.push(docHref(copy.kind, copy.id)),
  });

  // Leaving with unsaved changes asks first: the browser's own prompt for a reload or closing the tab, and our dialog for a
  // click on the menu or a breadcrumb and for the Back button.
  const guard = useUnsavedGuard(dirty && editable);

  /** Validates, then creates or updates. Resolves to the saved document, or null when nothing was saved. */
  async function save(): Promise<SalesDoc | null> {
    if (!editable || saving) return current;
    if (hasErrors(errors)) {
      setShowErrors(true);
      document.getElementById(`${base}-top`)?.scrollIntoView({ block: 'nearest' });
      return null;
    }
    setSaving(true);
    try {
      const input = draftToInput(draft);
      const result = current
        ? await actions.save(current, input)
        : await actions.create(kind, input);
      if (!result) return null;
      setLiveDoc(result);
      const next = draftFromDoc(result);
      setSaved(next);
      setDraft((cur) => ({ ...cur, lines: cur.lines.length ? cur.lines : next.lines }));
      setShowErrors(false);
      if (!current) router.replace(docHref(result.kind, result.id));
      return result;
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    const d = editable && (dirty || !current) ? await save() : current;
    if (d) controller.run('send', d);
  }

  // Keyboard: Ctrl/Cmd+S saves, Ctrl/Cmd+Enter sends, Alt+N adds a row.
  const saveRef = useRef(save);
  saveRef.current = save;
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const action = builderHotkey({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        inDialog: !!document.querySelector('dialog[open]') || !!el?.closest('[role="menu"]'),
      });
      if (!action || !editable) return;
      e.preventDefault();
      if (action === 'save') void saveRef.current();
      else if (action === 'send') void sendRef.current();
      else {
        const line = {
          ...draft.lines[0]!,
          key: newKey(),
          description: '',
          unit: '',
          discount: '',
          tax: '',
          qty: '1',
        };
        setDraft((cur) => ({ ...cur, lines: [...cur.lines, line] }));
        setFocusKey(line.key);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((cur) => ({ ...cur, [key]: value }));
  const allowed = current
    ? allowedActions(status, {
        can: {
          update: can.update,
          create: can.create,
          delete: can.remove,
          send: can.send,
          convert: can.convert,
          order: can.order,
        },
        hasDeal: current.deal !== null,
        empty: current.items.length === 0,
        server: current.actions,
      })
    : null;
  const canEdit = editable && (current ? can.update : can.create);
  const fe = showErrors ? errors.fields : {};
  const KindIcon = kind === 'proposal' ? ProposalIcon : EstimateIcon;

  const left = (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
      <legend className="sr-only">{t('formLabel')}</legend>
      <Section title={t('buyer.title')} hint={t('buyer.hint')}>
        <div className="space-y-3">
          <Field label={t('buyer.contact')} htmlFor={`${base}-contact`}>
            <RecordPicker
              id={`${base}-contact`}
              kind="contact"
              allowCreate
              disabled={!canEdit}
              value={draft.contact}
              onChange={(ref, hit) => fillContact(ref, hit?.email ?? '', hit?.phone ?? '')}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('buyer.name')} htmlFor={`${base}-bname`}>
              <Input
                id={`${base}-bname`}
                value={draft.buyerName}
                onChange={(e) => set('buyerName', e.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('buyer.email')}
              htmlFor={`${base}-bemail`}
              error={fe.email ? te(fe.email) : undefined}
            >
              <Input
                id={`${base}-bemail`}
                type="email"
                dir="ltr"
                value={draft.buyerEmail}
                invalid={!!fe.email}
                onChange={(e) => set('buyerEmail', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('buyer.phone')}
              htmlFor={`${base}-bphone`}
              hint={t('buyer.phoneHint')}
              error={fe.phone ? te(fe.phone) : undefined}
              className="sm:col-span-2"
            >
              <Input
                id={`${base}-bphone`}
                type="tel"
                dir="ltr"
                value={draft.buyerPhone}
                invalid={!!fe.phone}
                onChange={(e) => set('buyerPhone', e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title={t('details.title')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('details.docTitle')}
            htmlFor={`${base}-title`}
            error={fe.title ? te(fe.title) : undefined}
            className="sm:col-span-2"
          >
            <Input
              id={`${base}-title`}
              value={draft.title}
              placeholder={t(`details.titlePlaceholder.${kind}`)}
              invalid={!!fe.title}
              maxLength={TITLE_MAX + 20}
              onChange={(e) => set('title', e.target.value)}
              dir="auto"
            />
          </Field>
          <Field label={t('details.deal')} htmlFor={`${base}-deal`}>
            <RecordPicker
              id={`${base}-deal`}
              kind="deal"
              disabled={!canEdit}
              value={draft.deal}
              onChange={(ref) => set('deal', ref)}
            />
          </Field>
          <Field label={t('details.currency')} htmlFor={`${base}-currency`}>
            <Select
              id={`${base}-currency`}
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              {currencyChoices(draft.currency, session.org.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('details.validUntil')}
            htmlFor={`${base}-valid`}
            error={fe.validUntil ? te(fe.validUntil) : undefined}
            className="sm:col-span-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`${base}-valid`}
                type="date"
                value={draft.validUntil}
                invalid={!!fe.validUntil}
                onChange={(e) => set('validUntil', e.target.value)}
                className="w-auto"
              />
              {[7, 14, 30].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="secondary"
                  onClick={() => set('validUntil', addDays(today, d))}
                >
                  {t('details.plusDays', { days: d })}
                </Button>
              ))}
              {draft.validUntil && (
                <Button size="sm" variant="ghost" onClick={() => set('validUntil', '')}>
                  {t('details.noExpiry')}
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Section>

      <Section title={t('items.title')} hint={t('items.hint')}>
        {showErrors && errors.form && (
          <Alert tone="danger" className="mb-3">
            {te(errors.form)}
          </Alert>
        )}
        <LineItemsEditor
          lines={draft.lines}
          onChange={(lines) => set('lines', lines)}
          currency={draft.currency}
          totals={totals.lines}
          errors={errors.lines}
          showErrors={showErrors}
          defaultTax={draft.taxRate}
          focusKey={focusKey}
        />

        <div className="mt-5 grid gap-5 border-t border-border pt-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field
              label={t('totals.defaultTax')}
              htmlFor={`${base}-tax`}
              hint={t('totals.defaultTaxHint')}
              error={fe.docTax ? te(fe.docTax) : undefined}
            >
              <div className="relative max-w-40">
                <Input
                  id={`${base}-tax`}
                  value={draft.taxRate}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0"
                  invalid={!!fe.docTax}
                  onChange={(e) => set('taxRate', e.target.value)}
                  className="pe-7 text-end tabular-nums"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                >
                  %
                </span>
              </div>
            </Field>
            <Field
              label={t('totals.discount')}
              htmlFor={`${base}-disc`}
              error={fe.docDiscount ? te(fe.docDiscount) : undefined}
            >
              <div className="flex max-w-60 gap-2">
                <Input
                  id={`${base}-disc`}
                  value={draft.discountValue}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0"
                  invalid={!!fe.docDiscount}
                  onChange={(e) => set('discountValue', e.target.value)}
                  className="text-end tabular-nums"
                />
                <Select
                  aria-label={t('totals.discountKind')}
                  value={draft.discountKind}
                  onChange={(e) => set('discountKind', e.target.value as Draft['discountKind'])}
                  className="w-24"
                >
                  <option value="percent">%</option>
                  <option value="amount">{draft.currency}</option>
                </Select>
              </div>
            </Field>
          </div>
          <dl className="space-y-1.5 text-sm" aria-live="polite">
            <Row
              label={t('totals.subtotal')}
              value={formatMoney(totals.subtotalMinor, draft.currency, locale)}
            />
            {totals.discountMinor > 0 && (
              <Row
                label={t('totals.discountRow')}
                value={`-${formatMoney(totals.discountMinor, draft.currency, locale)}`}
              />
            )}
            {totals.taxGroups
              .filter((g) => g.taxMinor > 0)
              .map((g) => (
                <Row
                  key={g.rateBp}
                  label={t('totals.taxRow', { percent: String(g.rateBp / 100) })}
                  value={formatMoney(g.taxMinor, draft.currency, locale)}
                />
              ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
              <dt>{t('totals.total')}</dt>
              <dd className="tabular-nums" dir="ltr">
                {formatMoney(totals.totalMinor, draft.currency, locale)}
              </dd>
            </div>
          </dl>
        </div>
      </Section>

      <Section title={t('notes.title')}>
        <div className="space-y-4">
          <TemplateField
            label={t('notes.notes')}
            id={`${base}-notes`}
            value={draft.notes}
            max={NOTES_MAX}
            error={fe.notes ? te(fe.notes) : undefined}
            onChange={(v) => set('notes', v)}
            templatesLabel={t('notes.insertTemplate')}
            templates={NOTE_TEMPLATES.map((k) => ({
              id: k,
              label: tt(`notes.${k}.label`),
              text: tt(`notes.${k}.text`),
            }))}
          />
          <TemplateField
            label={t('notes.terms')}
            id={`${base}-terms`}
            value={draft.terms}
            max={TERMS_MAX}
            error={fe.terms ? te(fe.terms) : undefined}
            onChange={(v) => set('terms', v)}
            templatesLabel={t('notes.insertTemplate')}
            templates={TERMS_TEMPLATES.map((k) => ({
              id: k,
              label: tt(`terms.${k}.label`),
              text: tt(`terms.${k}.text`),
            }))}
          />
        </div>
      </Section>
    </fieldset>
  );

  const preview = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('preview.title')}</h2>
        <Button size="sm" variant="secondary" onClick={printDocument}>
          <PrintIcon /> {t('preview.print')}
        </Button>
      </div>
      <div className="thin-scrollbar max-h-[calc(100dvh-9rem)] overflow-auto rounded-xl border border-border bg-muted p-3 sm:p-4">
        <DocumentPaper doc={paper} zone={zone} className="sm:p-7" />
      </div>
      <p className="text-xs text-muted-foreground">{t('preview.hint')}</p>
    </div>
  );

  return (
    <div className="space-y-3" id={`${base}-top`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink kind={kind} />
      </div>

      <header className="sticky top-14 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <KindIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">
                {current ? current.number : t(`newTitle.${kind}`)}
              </h1>
              {current && <StatusChip status={status} />}
              {dirty && canEdit && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  {t('unsaved')}
                </span>
              )}
            </div>
            <p className="mt-0.5 hidden truncate text-sm text-muted-foreground sm:block" dir="auto">
              {current
                ? current.title || t('untitledSub')
                : t('newSubtitle', { kind: tk(`${kind}.singular`) })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              disabled={saving || (!dirty && !!current)}
              onClick={() => void save()}
              aria-keyshortcuts="Control+S"
            >
              {saving && <Spinner />} {t('save')}
            </Button>
          )}
          {(current ? allowed?.has('send') : can.create && can.send) && (
            <Button
              variant="brand"
              disabled={saving}
              onClick={() => void send()}
              aria-keyshortcuts="Control+Enter"
            >
              <SendIcon /> {t('send')}
            </Button>
          )}
          {current && allowed?.has('createSalesOrder') && (
            <Link
              href={newSalesOrderHref({ quote: current.id })}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <InvoiceIcon /> {ta('createSalesOrder')}
            </Link>
          )}
          {current && allowed && (
            <Menu
              label={t('more')}
              align="end"
              triggerClassName="size-10 px-0"
              triggerProps={{ 'aria-label': t('more'), title: t('more') }}
              trigger={<MoreIcon className="size-4" />}
            >
              {(close) => (
                <DocMenuItems
                  allowed={new Set([...allowed].filter((a) => a !== 'edit' && a !== 'send'))}
                  close={close}
                  onRun={(a) => controller.run(a, current)}
                />
              )}
            </Menu>
          )}
        </div>
      </header>

      {current && !editable && (
        <Alert
          tone={status === 'converted' ? 'success' : 'info'}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            {status === 'converted' ? (
              current.invoice ? (
                <>
                  {t('locked.converted')}{' '}
                  <Link
                    href={`/invoices/${current.invoice.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {t('locked.openInvoice')}
                  </Link>
                </>
              ) : (
                t('locked.converted')
              )
            ) : status === 'accepted' ? (
              t('locked.accepted')
            ) : (
              t('locked.sent')
            )}
          </span>
          <span className="flex flex-wrap gap-2">
            {allowed?.has('revise') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => controller.run('revise', current)}
              >
                {t('locked.revise')}
              </Button>
            )}
            {can.create && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => controller.run('duplicate', current)}
              >
                {t('locked.duplicate')}
              </Button>
            )}
          </span>
        </Alert>
      )}
      {showErrors && hasErrors(errors) && <Alert tone="danger">{t('fixErrors')}</Alert>}

      {/* phones: one pane at a time */}
      <div
        className="flex gap-1 rounded-md border border-border p-1 lg:hidden"
        role="tablist"
        aria-label={t('panes')}
      >
        {(['edit', 'preview'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              'flex-1 rounded px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
              pane === p
                ? 'bg-brand text-brand-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`pane.${p}`)}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className={cn(pane === 'preview' && 'hidden lg:block')}>{left}</div>
        <div className={cn('lg:sticky lg:top-4', pane === 'edit' && 'hidden lg:block')}>
          {preview}
        </div>
      </div>

      <PrintSheet doc={paper} zone={zone} />
      {activityFor && (
        <ActivityDrawer
          docId={activityFor.id}
          number={activityFor.number}
          onClose={() => setActivityFor(null)}
        />
      )}
      {controller.node}
      <ConfirmDialog
        open={guard.pending !== null}
        title={t('leaveTitle')}
        message={t('leaveMessage')}
        confirmLabel={t('leave')}
        cancelLabel={t('keepEditing')}
        tone="danger"
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums" dir="ltr">
        {value}
      </dd>
    </div>
  );
}

/** A multi-line field with a "Use a template" menu that appends ready-made text. */
function TemplateField({
  label,
  id,
  value,
  max,
  error,
  onChange,
  templatesLabel,
  templates,
}: {
  label: string;
  id: string;
  value: string;
  max: number;
  error?: string;
  onChange: (v: string) => void;
  templatesLabel: string;
  templates: Array<{ id: string; label: string; text: string }>;
}) {
  const t = useTranslations('sales-docs.builder.notes');
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        <Menu
          label={templatesLabel}
          align="end"
          triggerClassName="h-7 px-2 text-xs"
          trigger={<>{templatesLabel}</>}
        >
          {(close) =>
            templates.map((tp) => (
              <button
                key={tp.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(appendTemplate(value, tp.text, max));
                  close();
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded px-2.5 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="font-medium">{tp.label}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{tp.text}</span>
              </button>
            ))
          }
        </Menu>
      </div>
      <Textarea
        id={id}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        invalid={!!error}
        dir="auto"
      />
      <div className="flex items-start justify-between gap-2">
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : (
          <span />
        )}
        <span
          className={cn(
            'text-xs tabular-nums',
            value.length > max ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {t('count', { count: value.length, max })}
        </span>
      </div>
    </div>
  );
}

export { minorToInput };
