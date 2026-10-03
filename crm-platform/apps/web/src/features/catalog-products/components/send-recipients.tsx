'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Input, Textarea, cn } from '@crm/ui';
import { CATALOG_SEND_MAX_RECIPIENTS, type CatalogSendOptions } from '@crm/contracts';
import {
  RECIPIENT_MODES,
  filterContacts,
  overRecipientCap,
  toggleId,
  type RecipientMode,
  type SendForm,
} from '../lib/send-model';
import { CARD, StepBadge, TEXT_LINK } from './parts';

const EMPTY_BOX =
  'rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground';

/** Step 01 of the Send tab: recipients from contact groups, individual contacts or pasted numbers (WD-CAT-014). */
export function RecipientsStep({
  form,
  options,
  count,
  patch,
  onCapReached,
}: {
  form: SendForm;
  options: CatalogSendOptions;
  count: number;
  patch: (p: Partial<SendForm>) => void;
  /** Ticking a 501st contact is refused (the API takes at most 500 contact ids). */
  onCapReached: () => void;
}) {
  const t = useTranslations('catalogProducts.send.recipients');
  const [search, setSearch] = useState('');
  const contacts = useMemo(
    () => filterContacts(options.contacts, search),
    [options.contacts, search],
  );

  const tileClass =
    'block h-full rounded-xl border border-border p-3 transition peer-checked:border-brand peer-checked:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-primary hover:bg-muted/60';

  return (
    <section className={cn(CARD, 'p-5')} aria-labelledby="cat-send-recipients">
      <div className="mb-4 flex items-center gap-2.5">
        <StepBadge n="01" />
        <h3
          id="cat-send-recipients"
          className="flex-1 font-serif text-[18px] font-normal leading-none"
        >
          {t('title')}
        </h3>
        <span
          aria-live="polite"
          className={cn(
            'font-mono text-[10px]',
            overRecipientCap(count) ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {t('count', { count })}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={t('source')}
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {RECIPIENT_MODES.map((mode: RecipientMode) => (
          <label key={mode} className="relative cursor-pointer">
            <input
              type="radio"
              name="recipient_mode"
              value={mode}
              checked={form.recipientMode === mode}
              onChange={() => patch({ recipientMode: mode })}
              className="peer sr-only"
            />
            <span className={tileClass}>
              <span className="block font-serif text-[15px] leading-tight">
                {t(`modes.${mode}.title`)}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {t(`modes.${mode}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {form.recipientMode === 'groups' &&
        (options.groups.length === 0 ? (
          <div className={EMPTY_BOX}>
            {t.rich('noGroups', {
              link: (chunks) => (
                <Link href="/contact-groups" className={TEXT_LINK}>
                  {chunks}
                </Link>
              ),
            })}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.groups.map((g) => (
              <li key={g.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/60">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold">{g.name}</span>
                    <span className="block text-[10.5px] text-muted-foreground">
                      {t('groupContacts', { count: g.count })}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.groupIds.includes(g.id)}
                    onChange={() => patch({ groupIds: toggleId(form.groupIds, g.id) })}
                    className="size-4 accent-[var(--primary)]"
                    aria-label={g.name}
                  />
                </label>
              </li>
            ))}
          </ul>
        ))}

      {form.recipientMode === 'contacts' &&
        (options.contacts.length === 0 ? (
          <div className={EMPTY_BOX}>
            {t.rich('noContacts', {
              link: (chunks) => (
                <Link href="/contacts" className={TEXT_LINK}>
                  {chunks}
                </Link>
              ),
            })}
          </div>
        ) : (
          <>
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchContacts')}
              aria-label={t('searchContacts')}
              className="mb-2 h-9 bg-muted text-[12px]"
            />
            <ul className="grid max-h-[220px] grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2 lg:grid-cols-3">
              {contacts.map((c) => {
                const checked = form.contactIds.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (!checked && form.contactIds.length >= CATALOG_SEND_MAX_RECIPIENTS) {
                            onCapReached();
                            return;
                          }
                          patch({ contactIds: toggleId(form.contactIds, c.id) });
                        }}
                        className="size-3.5 accent-[var(--primary)]"
                      />
                      <span className="truncate text-[12px]">{c.name || c.mobile || '—'}</span>
                    </label>
                  </li>
                );
              })}
              {contacts.length === 0 && (
                <li className="col-span-full py-3 text-center text-[12px] text-muted-foreground">
                  {t('noMatch')}
                </li>
              )}
            </ul>
          </>
        ))}

      {form.recipientMode === 'manual' && (
        <div>
          <label htmlFor="cat-manual" className="mb-1.5 block text-[11.5px] font-semibold">
            {t('paste')}
          </label>
          <Textarea
            id="cat-manual"
            rows={6}
            value={form.manual}
            onChange={(e) => patch({ manual: e.target.value })}
            placeholder={t('pastePlaceholder')}
            className="text-[12.5px] leading-relaxed"
          />
          <p className="mt-1 text-[10.5px] text-muted-foreground">{t('pasteHint')}</p>
        </div>
      )}

      {overRecipientCap(count) && (
        <p role="alert" className="mt-3 text-[11.5px] text-danger">
          {t('overCap', { max: CATALOG_SEND_MAX_RECIPIENTS })}
        </p>
      )}
    </section>
  );
}
