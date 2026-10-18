'use client';

import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink, useCanPickCompany } from '@/features/companies';
import { updateContact } from '../../api/contacts';
import { useContactFields } from '../../api/properties';
import type { ContactRow } from '../../api/schemas';
import { EXTRA_KEYS, formatPhone } from '../../lib/contact-model';
import { socialLinks } from '../../lib/contact-overview';
import { isMaskedPhone } from '../../lib/row-actions';
import { errorKind } from '../../lib/errors';
import { ContactFormModal } from '../contact-form-modal';
import { GroupChip } from '../chips';
import { ContactQuickTags } from '../contact-quick-tags';
import { ChevronDownIcon, PencilIcon } from '../icons';
import { OwnerControl } from '../owner-control';
import { CustomFields, SocialRows, useInfoRows } from './info-tabs';
import { KeyValueList, useRefreshContact } from './shared';

type FieldKind = 'text' | 'email' | 'tel';

/** The workspace's own "city" property when it has one; the contact's address text stands in for it when it has not. */
export function cityKey(fields: readonly { key: string }[] | undefined): string | null {
  return fields?.find((f) => f.key.toLowerCase() === 'city')?.key ?? null;
}

/**
 * One value that is changed where it stands: the text with a pencil that shows on hover and focus (always on a touch screen), a click
 * opens a box, Enter or leaving it saves, Escape puts it back. A refused save keeps the box open with the reason; nothing typed is lost.
 */
function EditableText({
  label,
  value,
  display,
  kind = 'text',
  canEdit,
  ltr,
  maxLength = 255,
  onSave,
}: {
  label: string;
  value: string;
  /** What is shown when it is not being edited (a link, a formatted number); the plain value otherwise. */
  display?: ReactNode;
  kind?: FieldKind;
  canEdit: boolean;
  ltr?: boolean;
  maxLength?: number;
  /** Saves the new text; rejects with the error when the server refuses. */
  onSave: (next: string) => Promise<unknown>;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.keyDetails');
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const commit = async () => {
    if (draft === null || busy) return;
    const next = draft.trim();
    if (next === value) {
      setDraft(null);
      setProblem(null);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setDraft(null);
      setProblem(null);
    } catch (e) {
      const kind = errorKind(e);
      setProblem(
        kind === 'conflict'
          ? t('conflict')
          : kind === 'validation'
            ? t('invalid', { field: label })
            : kind === 'forbidden'
              ? t('forbidden')
              : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (draft !== null) {
    return (
      <div>
        <input
          id={id}
          autoFocus
          type={kind}
          value={draft}
          maxLength={maxLength}
          disabled={busy}
          dir={ltr ? 'ltr' : 'auto'}
          aria-label={label}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              // Escape only ends the edit; it must not also close a drawer around it.
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
              setProblem(null);
            }
          }}
          className={cn(
            'h-8 w-full rounded border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
            problem ? 'border-danger' : 'border-border',
          )}
        />
        {problem && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {problem}
          </p>
        )}
      </div>
    );
  }

  const shown = value ? (display ?? value) : null;
  if (!canEdit) {
    return shown ? (
      <span dir={ltr ? 'ltr' : 'auto'} className="break-words">
        {shown}
      </span>
    ) : (
      <span className="text-muted-foreground">&mdash;</span>
    );
  }
  return (
    <span className="group/edit flex min-w-0 items-center gap-1.5">
      {shown ? (
        <span dir={ltr ? 'ltr' : 'auto'} className="min-w-0 break-words">
          {shown}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => setDraft(value)}
        aria-label={t('edit', { field: label })}
        title={t('edit', { field: label })}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded text-xs text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary',
          shown
            ? 'size-5 justify-center opacity-0 group-hover/edit:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
            : 'italic',
        )}
      >
        {shown ? <PencilIcon className="size-3" /> : t('add', { field: label.toLowerCase() })}
      </button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * "Key details": the few things a person looks up first (phone, email, company, owner, city, source, last activity), each changed in
 * place where the person may, and "Show all" for the rest (every field, the custom properties, the social links) with a way to the full
 * edit form. It replaces the old tabs of the overview; nothing it showed is gone: the lead-source touches are in the Source section.
 */
export function KeyDetails({
  contact,
  onEditCompany,
  onOpenSection,
}: {
  contact: ContactRow;
  /** The company row's "Add": opens the Company card and puts the cursor in its search. */
  onEditCompany?: () => void;
  onOpenSection?: (section: 'lead-source') => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.keyDetails');
  const ti = useTranslations('contacts-attributes-tags.contact.info');
  const tg = useTranslations('contacts-attributes-tags.contact.owner');
  const format = useFormatter();
  const now = useNow();
  const canUpdate = useCan('record.contacts.update');
  const canPickCompany = useCanPickCompany();
  const fields = useContactFields();
  const [all, setAll] = useState(false);
  // On a phone the list starts folded so the tabs and the timeline are not pushed down the page; from 768 px it is always open.
  const [mobileOpen, setMobileOpen] = useState(
    () =>
      typeof window === 'undefined' || (window.matchMedia?.('(min-width: 768px)').matches ?? true),
  );
  const [editing, setEditing] = useState(false);
  const allId = useId();

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateContact(contact.id, { ...patch, rowVersion: contact.rowVersion }),
  });
  const refresh = useRefreshContact(contact.id);
  const saveField = async (patch: Record<string, unknown>) => {
    try {
      await save.mutateAsync(patch);
      await refresh();
    } catch (e) {
      // A changed row is reloaded, so the next try carries the right version.
      if (errorKind(e) === 'conflict') await refresh();
      throw e;
    }
  };

  const text = (key: string) =>
    typeof contact.customFields[key] === 'string' ? (contact.customFields[key] as string) : '';
  const phoneMasked = contact.phone ? isMaskedPhone(contact.phone) : false;
  const city = cityKey(fields.data);
  const place = city ?? EXTRA_KEYS.address;
  const source = contact.source ?? text(EXTRA_KEYS.source);
  const infoRows = useInfoRows(contact, { full: true });
  const hasSocial = socialLinks(contact.customFields).length > 0;

  return (
    <section
      aria-label={t('aboutTitle')}
      className="rounded-xl border border-border bg-background"
      data-testid="key-details"
    >
      <header className="flex min-h-11 items-center justify-between gap-3 px-4 pt-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">
          <button
            type="button"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:w-full md:pointer-events-none"
          >
            {t('aboutTitle')}
            <ChevronDownIcon
              className={cn(
                'size-3.5 text-muted-foreground transition md:hidden',
                mobileOpen && 'rotate-180',
              )}
            />
          </button>
        </h2>
        {canUpdate && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('editAll')}
          </button>
        )}
      </header>
      <div className={cn(!mobileOpen && 'max-md:hidden')}>
        <dl className="divide-y divide-border/60 px-4 pb-1 pt-1">
          <Row label={ti('phone')}>
            <EditableText
              label={ti('phone')}
              value={contact.phone ?? ''}
              display={formatPhone(contact.phone)}
              kind="tel"
              ltr
              maxLength={32}
              canEdit={canUpdate && !phoneMasked}
              onSave={(next) => saveField({ phone: next === '' ? null : next })}
            />
          </Row>
          <Row label={ti('email')}>
            <EditableText
              label={ti('email')}
              value={contact.email ?? ''}
              display={
                <a
                  href={`mailto:${contact.email}`}
                  className="break-all text-primary underline-offset-2 hover:underline"
                >
                  {contact.email}
                </a>
              }
              kind="email"
              ltr
              canEdit={canUpdate}
              onSave={(next) => saveField({ email: next === '' ? null : next })}
            />
          </Row>
          <Row label={t('owner')}>
            <OwnerControl
              contactId={contact.id}
              ownerId={contact.ownerId}
              rowVersion={contact.rowVersion}
              canEdit={canUpdate}
            />
          </Row>
          <Row label={ti('company')}>
            <span className="flex min-w-0 items-center gap-2">
              {contact.companyId ? (
                <CompanyLink id={contact.companyId} />
              ) : canUpdate && canPickCompany && onEditCompany ? (
                <button
                  type="button"
                  onClick={onEditCompany}
                  className="rounded text-xs italic text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('add', { field: ti('company').toLowerCase() })}
                </button>
              ) : (
                <span className="text-muted-foreground">&mdash;</span>
              )}
              {contact.companyId && canUpdate && canPickCompany && onEditCompany && (
                <button
                  type="button"
                  onClick={onEditCompany}
                  aria-label={t('edit', { field: ti('company') })}
                  title={t('edit', { field: ti('company') })}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 outline-none transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <PencilIcon className="size-3" />
                </button>
              )}
            </span>
          </Row>
          <Row label={city ? t('city') : ti('address')}>
            <EditableText
              label={city ? t('city') : ti('address')}
              value={text(place)}
              canEdit={canUpdate}
              onSave={(next) => saveField({ customFields: { [place]: next } })}
            />
          </Row>
          <Row label={ti('source')}>
            <EditableText
              label={ti('source')}
              value={source}
              canEdit={canUpdate}
              maxLength={128}
              onSave={(next) => saveField({ source: next === '' ? null : next })}
            />
          </Row>
          <Row label={ti('createdAt')}>
            <time
              dateTime={contact.createdAt}
              title={format.dateTime(new Date(contact.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            >
              {format.relativeTime(new Date(contact.createdAt), now)}
            </time>
          </Row>
          <Row label={ti('lastActivity')}>
            {contact.lastActivityAt ? (
              <time
                dateTime={contact.lastActivityAt}
                title={format.dateTime(new Date(contact.lastActivityAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              >
                {format.relativeTime(new Date(contact.lastActivityAt), now)}
              </time>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </Row>
        </dl>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2.5">
          <ContactQuickTags contactId={contact.id} labelled />
        </div>
        {(contact.groups ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{tg('groups')}</span>
            {(contact.groups ?? []).map((g) => (
              <GroupChip key={g.id} name={g.name} color={g.color} />
            ))}
          </div>
        )}
        <div className="border-t border-border/60 px-4 py-2">
          <button
            type="button"
            aria-expanded={all}
            aria-controls={allId}
            onClick={() => setAll((v) => !v)}
            className="rounded text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {all ? t('showLess') : t('showAll')}
          </button>
        </div>
        {all && (
          <div id={allId} className="space-y-4 border-t border-border px-4 py-3">
            <KeyValueList rows={infoRows} narrow />
            {hasSocial && (
              <div className="space-y-2">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('social')}
                </h3>
                <SocialRows contact={contact} />
              </div>
            )}
            <div className="space-y-2">
              <CustomFields contact={contact} />
            </div>
            {onOpenSection && (
              <button
                type="button"
                onClick={() => onOpenSection('lead-source')}
                className="rounded text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('leadSource')}
              </button>
            )}
          </div>
        )}
      </div>
      <ContactFormModal open={editing} contact={contact} onClose={() => setEditing(false)} />
    </section>
  );
}
