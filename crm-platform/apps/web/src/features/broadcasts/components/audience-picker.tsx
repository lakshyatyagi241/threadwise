'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, cn } from '@crm/ui';
import type {
  ContactGroupResponse,
  ContactResponse,
  SegmentResponse,
  TagResponse,
} from '@crm/contracts';
import type { AudienceFilter } from '../api/compose';
import { contactName, matchesSearch, toggle } from '../lib/compose-model';
import { SearchIcon } from './icons';

const KICKER =
  'mr-1 self-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';
const CHIP =
  'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11.5px] hover:bg-muted';

/**
 * "Who do you want to send it to?" (TW-BCAST-007): tag and group chips plus a searchable table of the newest contacts, all
 * merged by the server (first occurrence wins, opted-out and archived contacts dropped).
 */
export function AudiencePicker({
  tags,
  groups,
  segments,
  contacts,
  contactsDenied,
  filter,
  onFilter,
  selectedTags,
  selectedGroups,
  selectedSegments,
  selectedContacts,
  onTags,
  onGroups,
  onSegments,
  onContacts,
  email = false,
}: {
  tags: TagResponse[];
  groups: ContactGroupResponse[];
  segments: SegmentResponse[];
  contacts: ContactResponse[];
  /** The caller may not read contacts: the table is replaced by a note. */
  contactsDenied: boolean;
  /** The table's server-side filters (tag, group, consent). */
  filter: AudienceFilter;
  onFilter: (f: AudienceFilter) => void;
  selectedTags: string[];
  selectedGroups: string[];
  selectedSegments: string[];
  selectedContacts: string[];
  onTags: (ids: string[]) => void;
  onGroups: (ids: string[]) => void;
  onSegments: (ids: string[]) => void;
  onContacts: (ids: string[]) => void;
  /** An email campaign: the table shows each contact's email address (and says when there is none) instead of the phone. */
  email?: boolean;
}) {
  const t = useTranslations('broadcasts.compose');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () =>
      contacts
        .map((c) => ({
          id: c.id,
          name: contactName(c),
          phone: (email ? c.email : c.phone) ?? '',
        }))
        .filter((r) => matchesSearch(r, q)),
    [contacts, q, email],
  );
  const allShown = rows.length > 0 && rows.every((r) => selectedContacts.includes(r.id));
  const count = selectedContacts.length;

  const chip = (
    key: string,
    on: boolean,
    change: () => void,
    label: string,
    extra?: React.ReactNode,
  ) => (
    <label key={key} className={cn(CHIP, 'relative', on && 'border-brand bg-muted')}>
      <input
        type="checkbox"
        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
        checked={on}
        onChange={change}
      />
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-[10px] leading-none text-white peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand"
      >
        {on ? '✓' : ''}
      </span>
      {extra}
      <span>{label}</span>
    </label>
  );

  return (
    <div className="border-t border-border pt-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl leading-tight">{t('audience')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('audienceHint')}</p>
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground" aria-live="polite">
          {t('selected', { count })}
        </span>
      </div>

      <ChipRow
        label={t('segments')}
        empty={t('noSegments')}
        href="/segments"
        action={t('createOne')}
      >
        {segments.map((sg) =>
          chip(
            sg.id,
            selectedSegments.includes(sg.id),
            () => onSegments(toggle(selectedSegments, sg.id)),
            sg.memberCount == null ? sg.name : `${sg.name} · ${sg.memberCount}`,
          ),
        )}
      </ChipRow>
      <ChipRow label={t('tags')} empty={t('noTags')} href="/contacts" action={t('createOne')}>
        {tags.map((tg) =>
          chip(
            tg.id,
            selectedTags.includes(tg.id),
            () => onTags(toggle(selectedTags, tg.id)),
            tg.name,
            <span
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: tg.color ?? 'var(--brand)' }}
              aria-hidden="true"
            />,
          ),
        )}
      </ChipRow>
      <ChipRow
        label={t('groups')}
        empty={t('noGroups')}
        href="/contact-groups"
        action={t('createOne')}
      >
        {groups.map((g) =>
          chip(
            g.id,
            selectedGroups.includes(g.id),
            () => onGroups(toggle(selectedGroups, g.id)),
            g.name,
          ),
        )}
      </ChipRow>

      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('filters')}
      >
        <span className={KICKER}>{t('filters')}</span>
        <FilterSelect
          label={t('filterTag')}
          value={filter.tagId ?? ''}
          onChange={(tagId) => onFilter({ ...filter, tagId: tagId || undefined })}
          options={tags.map((x) => ({ value: x.id, label: x.name }))}
        />
        <FilterSelect
          label={t('filterGroup')}
          value={filter.groupId ?? ''}
          onChange={(groupId) => onFilter({ ...filter, groupId: groupId || undefined })}
          options={groups.map((x) => ({ value: x.id, label: x.name }))}
        />
        <FilterSelect
          label={t('filterConsent')}
          value={filter.consent ?? ''}
          onChange={(consent) =>
            onFilter({ ...filter, consent: (consent || undefined) as AudienceFilter['consent'] })
          }
          options={[
            { value: 'subscribed', label: t('consentSubscribed') },
            { value: 'optedOut', label: t('consentOptedOut') },
          ]}
        />
        {(filter.tagId || filter.groupId || filter.consent) && (
          <button
            type="button"
            className="text-[11.5px] font-semibold text-brand hover:underline"
            onClick={() => onFilter({})}
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="ps-9 text-[12.5px]"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full table-fixed text-[12.5px]">
            <thead className="sticky top-0 border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th className="w-[56px] p-0 text-start">
                  <label className="flex size-11 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      className="size-6 accent-[var(--brand)]"
                      checked={allShown}
                      disabled={rows.length === 0}
                      onChange={(e) => {
                        const shown = rows.map((r) => r.id);
                        onContacts(
                          e.target.checked
                            ? [...new Set([...selectedContacts, ...shown])]
                            : selectedContacts.filter((id) => !shown.includes(id)),
                        );
                      }}
                    />
                  </label>
                </th>
                <th className="px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]">
                  {t('colName')}
                </th>
                <th className="w-[200px] px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]">
                  {email ? t('colEmail') : t('colPhone')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contactsDenied ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t('contactsDenied')}
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t('noContacts')}{' '}
                    <Link href="/contacts" className="font-semibold text-brand hover:underline">
                      {t('addSome')}
                    </Link>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t('noMatch')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="p-0">
                      <label className="flex size-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          aria-label={r.name}
                          className="size-6 accent-[var(--brand)]"
                          checked={selectedContacts.includes(r.id)}
                          onChange={() => onContacts(toggle(selectedContacts, r.id))}
                        />
                      </label>
                    </td>
                    <td className="truncate px-3 py-2.5 font-semibold">{r.name}</td>
                    <td className="truncate px-3 py-2.5 font-mono text-[11px]">
                      {r.phone || (email ? t('noEmail') : '—')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A labelled row of chips; with none to show it says so and links to where one is made. */
function ChipRow({
  label,
  empty,
  href,
  action,
  children,
}: {
  label: string;
  empty: string;
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className={KICKER}>{label}</span>
      {has ? (
        children
      ) : (
        <span className="text-[11.5px] text-muted-foreground">
          {empty}{' '}
          <Link href={href} className="font-semibold text-brand hover:underline">
            {action}
          </Link>
        </span>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-full border border-border bg-background px-3 text-[11.5px]"
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
