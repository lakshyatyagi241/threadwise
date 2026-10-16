'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Input, Modal, Spinner, useToast } from '@crm/ui';
import { companiesApi, invalidateCompanies, useCompanyContacts } from '../api/companies';
import type { ContactHit } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { useDebounced } from '../lib/use-debounced';
import { ErrorLine } from './error-line';
import { LinkIcon, SearchIcon, UnlinkIcon } from './icons';

/** What a contact is called on this screen: its name, else first and last name, else the number. Reference said "(no name)". */
const nameOf = (c: {
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone: string | null;
}) => c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || null;

export interface LinkedContactsProps {
  companyId: string;
  /** May the person put contacts under this company and take them out (companies.update and contacts.update)? */
  canLink: boolean;
}

/**
 * The company's contacts (TW-CTP-005, 006): Reference's card (name and number, each a link to the contact) plus what Reference could
 * only do through its AI copilot: add existing contacts to the company, and take one out.
 */
export function LinkedContacts({ companyId, canLink }: LinkedContactsProps) {
  const t = useTranslations('companies.contacts');
  const tToast = useTranslations('companies.toast');
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useCompanyContacts(companyId);
  const [adding, setAdding] = useState(false);

  const unlink = useMutation({
    mutationFn: (contactId: string) => companiesApi.unlinkContact(companyId, contactId),
    onSuccess: async () => {
      await invalidateCompanies(qc, companyId);
      toast(tToast('contactUnlinked'), 'success');
    },
    onError: async (e) => {
      await invalidateCompanies(qc, companyId);
      toast(
        errorKind(e) === 'notFound' ? tToast('contactAlreadyOut') : tToast('contactUnlinkFailed'),
        'danger',
      );
    },
  });

  return (
    <section
      aria-labelledby="company-contacts"
      className="space-y-3 rounded-md border border-border bg-background p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="company-contacts"
          className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t('title')}
          {list.isSuccess && (
            <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal">
              {list.items.length}
              {list.hasNextPage ? '+' : ''}
            </span>
          )}
        </h2>
        {canLink && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <LinkIcon /> {t('add')}
          </Button>
        )}
      </div>

      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-1">
          {list.items.map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded-md hover:bg-muted/50">
              <Link
                href={`/contacts/${c.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" dir="auto">
                    {c.name || t('unnamed')}
                  </span>
                  {c.email && (
                    <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                      {c.email}
                    </span>
                  )}
                </span>
                {c.phone && (
                  <span dir="ltr" className="shrink-0 font-mono text-xs text-muted-foreground">
                    {c.phone}
                  </span>
                )}
              </Link>
              {canLink && (
                <button
                  type="button"
                  title={t('unlink')}
                  aria-label={t('unlinkNamed', { name: c.name || t('unnamed') })}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(c.id)}
                  className="me-1 inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  <UnlinkIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('loadMore')}
        </Button>
      )}

      {adding && <AddContactsModal companyId={companyId} onClose={() => setAdding(false)} />}
    </section>
  );
}

/** Search the workspace's contacts and put the ticked ones under the company. */
function AddContactsModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const t = useTranslations('companies.contacts.addModal');
  const tToast = useTranslations('companies.toast');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const hits = useQuery({
    queryKey: ['companies', 'contact-search', debounced],
    queryFn: ({ signal }) => companiesApi.searchContacts(debounced, signal),
    retry: false,
    placeholderData: (prev) => prev,
  });

  const link = useMutation({
    mutationFn: () => companiesApi.linkContacts(companyId, [...ticked]),
    onSuccess: async (result) => {
      await invalidateCompanies(qc, companyId);
      await qc.invalidateQueries({ queryKey: ['companies', 'contact-search'] });
      toast(
        result.failed.length > 0
          ? tToast('contactsLinkedSome', {
              count: result.succeeded.length,
              failed: result.failed.length,
            })
          : tToast('contactsLinked', { count: result.succeeded.length }),
        result.failed.length > 0 ? 'info' : 'success',
      );
      onClose();
    },
    onError: () => toast(tToast('contactsLinkFailed'), 'danger'),
  });

  const rows: ContactHit[] = hits.data ?? [];
  const flip = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!link.isPending) onClose();
      }}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={link.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={ticked.size === 0 || link.isPending}
            onClick={() => link.mutate()}
          >
            {link.isPending && <Spinner />}
            {t('add', { count: ticked.size })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="ps-9"
          />
        </div>
        {hits.isPending ? (
          <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : hits.isError ? (
          <ErrorLine error={hits.error} context="list" onRetry={() => void hits.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('noneTitle')} message={t('none')} />
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {rows.map((c) => {
              const here = c.companyId === companyId;
              const elsewhere = c.companyId !== null && !here;
              return (
                <li key={c.id}>
                  <label
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${here ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}
                  >
                    <input
                      type="checkbox"
                      disabled={here}
                      checked={here || ticked.has(c.id)}
                      onChange={() => flip(c.id)}
                      className="size-4 accent-[var(--brand)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" dir="auto">
                        {nameOf(c) ?? t('unnamed')}
                      </span>
                      {c.phone && (
                        <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
                          {c.phone}
                        </span>
                      )}
                    </span>
                    {here && <span className="text-xs text-muted-foreground">{t('already')}</span>}
                    {elsewhere && <span className="text-xs text-warning">{t('willMove')}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
    </Modal>
  );
}
