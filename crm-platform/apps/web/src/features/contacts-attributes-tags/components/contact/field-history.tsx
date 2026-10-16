'use client';

import { useState } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { FieldHistoryEntry } from '@crm/contracts';
import { Button, Drawer, Spinner } from '@crm/ui';
import { useFieldHistory } from '../../api/field-history';
import { fallbackFieldLabel, historyEntryKey, historyValueText } from '../../lib/contact-data';
import { titleCaseKey } from '../../lib/contact-model';
import { formatDateTime } from '../../lib/format';
import { ErrorLine } from '../error-line';
import { HistoryIcon } from '../icons';
import { EmptyLine, Panel } from './shared';

type Translate = ReturnType<typeof useTranslations>;

/** The well-known keys through their messages (literal keys, so each is visibly used); anything else is title-cased. */
function fieldLabel(t: Translate, key: string): string {
  switch (key) {
    case 'name':
      return t('fields.name');
    case 'firstName':
      return t('fields.firstName');
    case 'lastName':
      return t('fields.lastName');
    case 'email':
      return t('fields.email');
    case 'phone':
      return t('fields.phone');
    case 'companyId':
      return t('fields.companyId');
    case 'ownerId':
      return t('fields.ownerId');
    case 'lifecycleStage':
      return t('fields.lifecycleStage');
    case 'lifecycleState':
      return t('fields.lifecycleState');
    case 'status':
      return t('fields.status');
    case 'lostReason':
      return t('fields.lostReason');
    case 'leadScore':
      return t('fields.leadScore');
    case 'source':
      return t('fields.source');
    case 'isUnsubscribed':
      return t('fields.isUnsubscribed');
    default:
      return fallbackFieldLabel(key);
  }
}

function actorLabel(t: Translate, actorType: string): string {
  switch (actorType) {
    case 'user':
      return t('actor.user');
    case 'system':
      return t('actor.system');
    case 'api':
      return t('actor.api');
    default:
      return titleCaseKey(actorType);
  }
}

/**
 * The contact's field-level change history, newest first, with "Load more". Shows the actor type only: the API sends the
 * changing person's id, and there is no name lookup for it here. `showTitle` is off inside the drawer, which has its own.
 */
export function FieldHistoryPanel({
  contactId,
  showTitle = true,
}: {
  contactId: string;
  showTitle?: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.history');
  const list = useFieldHistory(contactId);

  return (
    <Panel id="contact-field-history" title={showTitle ? t('title') : undefined}>
      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyLine>{t('empty')}</EmptyLine>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-border">
            {list.items.map((e, i) => (
              <HistoryRow key={historyEntryKey(e, i)} entry={e} />
            ))}
          </ul>
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
        </div>
      )}
    </Panel>
  );
}

function ValueText({ value }: { value: unknown }) {
  const t = useTranslations('contacts-attributes-tags.contact.history');
  const text = historyValueText(value);
  if (text === '') {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">&mdash;</span>
        <span className="sr-only">{t('noValue')}</span>
      </span>
    );
  }
  return (
    <span className="break-words" dir="auto">
      {text}
    </span>
  );
}

function HistoryRow({ entry }: { entry: FieldHistoryEntry }) {
  const t = useTranslations('contacts-attributes-tags.contact.history');
  const locale = useLocale();
  const timeZone = useTimeZone();
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="text-sm font-medium">{fieldLabel(t, entry.fieldKey)}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
        <span className="text-muted-foreground line-through decoration-muted-foreground/50">
          <ValueText value={entry.oldValue} />
        </span>
        <span aria-hidden="true" className="text-muted-foreground rtl:rotate-180">
          &rarr;
        </span>
        <span className="sr-only">{t('changedTo')}</span>
        <ValueText value={entry.newValue} />
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {formatDateTime(entry.changedAt, locale, timeZone)}
        <span className="mx-1" aria-hidden="true">
          &middot;
        </span>
        {t('by', { actor: actorLabel(t, entry.actorType) })}
      </div>
    </li>
  );
}

/** A secondary button "Contact Field History" that opens the history in a drawer on the end edge. */
export function FieldHistoryButton({ contactId }: { contactId: string }) {
  const t = useTranslations('contacts-attributes-tags.contact.history');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <HistoryIcon />
        {t('button')}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('title')} closeLabel={t('close')}>
        <FieldHistoryPanel contactId={contactId} showTitle={false} />
      </Drawer>
    </>
  );
}
