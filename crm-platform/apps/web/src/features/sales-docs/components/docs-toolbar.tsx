'use client';

import { useTranslations } from 'next-intl';
import { Button, Input, Select, cn } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { salesDocsApi } from '../api/service';
import type { Member } from '../api/schemas';
import { hasActiveFilter, type DocFilters } from '../lib/filters';
import { CloseIcon, ContactIcon, DealIcon, KeyboardIcon, RefreshIcon, SearchIcon } from './icons';

/** The screen focuses the search box by this id when "/" is pressed. */
export const SEARCH_ID = 'sales-docs-search';

const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

export interface DocsToolbarProps {
  filters: DocFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<DocFilters>) => void;
  members: readonly Member[];
  onRefresh: () => void;
  refreshing: boolean;
  onHelp: () => void;
}

/** A filter that arrived in the address (a contact's or deal's documents): its name as a chip that can be dismissed. */
function LinkChip({
  kind,
  id,
  onClear,
}: {
  kind: 'contact' | 'deal';
  id: string;
  onClear: () => void;
}) {
  const t = useTranslations('sales-docs.toolbar');
  const ref = useQuery({
    queryKey: ['sales-docs', 'chip', kind, id],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      if (kind === 'contact') {
        const c = await salesDocsApi.contactById(id, signal);
        return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';
      }
      return (await salesDocsApi.dealById(id, signal)).title;
    },
  });
  const Icon = kind === 'contact' ? ContactIcon : DealIcon;
  return (
    <span className="inline-flex h-9 max-w-64 items-center gap-2 rounded-md border border-border bg-muted/40 ps-2.5 pe-1 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">
        {ref.data || t(kind === 'contact' ? 'contactFilter' : 'dealFilter')}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('removeFilter')}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** One compact row: search, owner, valid-until, a contact or deal chip, Clear, then refresh and shortcuts. */
export function DocsToolbar(p: DocsToolbarProps) {
  const t = useTranslations('sales-docs.toolbar');
  const f = p.filters;
  const active = hasActiveFilter({ ...f, q: p.q });

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={SEARCH_ID}
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          aria-keyshortcuts="/"
          className="h-9 ps-9"
        />
      </div>

      <Select
        aria-label={t('owner')}
        className="h-9 w-auto min-w-36 max-w-52"
        value={f.owner}
        onChange={(e) => p.onChange({ owner: e.target.value })}
      >
        <option value="">{t('allOwners')}</option>
        <option value="mine">{t('mine')}</option>
        {p.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName}
          </option>
        ))}
      </Select>

      <Select
        aria-label={t('validity')}
        className="h-9 w-auto min-w-36"
        value={f.validity}
        onChange={(e) => p.onChange({ validity: e.target.value as DocFilters['validity'] })}
      >
        <option value="">{t('anyValidity')}</option>
        <option value="week">{t('validWeek')}</option>
        <option value="lapsed">{t('validLapsed')}</option>
      </Select>

      {f.contact && (
        <LinkChip kind="contact" id={f.contact} onClear={() => p.onChange({ contact: '' })} />
      )}
      {f.deal && <LinkChip kind="deal" id={f.deal} onClear={() => p.onChange({ deal: '' })} />}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            p.onQ('');
            p.onChange({ q: '', owner: '', contact: '', deal: '', validity: '' });
          }}
        >
          {t('clear')}
        </Button>
      )}

      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          onClick={p.onRefresh}
          title={t('refresh')}
          aria-label={t('refresh')}
          className={iconBtn}
        >
          <RefreshIcon className={cn('size-4', p.refreshing && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={p.onHelp}
          title={t('shortcuts')}
          aria-label={t('shortcuts')}
          className={cn(iconBtn, 'hidden sm:inline-flex')}
        >
          <KeyboardIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
