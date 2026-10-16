'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { ConversationSummary } from '@crm/contracts';
import { Badge, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactConversations } from '../../api/conversations';
import { formatDateTime } from '../../lib/format';
import { ErrorLine } from '../error-line';
import { EmptyLine, Panel, type SectionProps } from './shared';

type Translate = ReturnType<typeof useTranslations>;

/** Literal keys so every message is visibly used. */
function statusLabel(t: Translate, status: ConversationSummary['status']): string {
  switch (status) {
    case 'pending':
      return t('status.pending');
    case 'snoozed':
      return t('status.snoozed');
    case 'resolved':
      return t('status.resolved');
    case 'closed':
      return t('status.closed');
    case 'spam':
      return t('status.spam');
    default:
      return t('status.open');
  }
}

/**
 * The contact's conversations. The API has no per-contact conversation route, so `useContactConversations` searches the inbox
 * and keeps the rows that belong to this contact (see its comment for what that can miss). Each row opens in the inbox.
 */
export function ConversationsSection({ contact, variant }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.conversations');
  const canRead = useCan('inbox.conversation.read');
  const found = useContactConversations(contact, canRead);

  return (
    <Panel
      id="contact-conversations"
      title={t('title')}
      bodyClassName={variant === 'drawer' ? 'px-3' : ''}
    >
      {!canRead || !found.searchable ? (
        <EmptyLine>{t('empty')}</EmptyLine>
      ) : found.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : found.isError ? (
        <ErrorLine error={found.error} onRetry={() => void found.refetch()} />
      ) : found.items.length === 0 ? (
        <EmptyLine>{t('empty')}</EmptyLine>
      ) : (
        <div className="space-y-2">
          <ul aria-label={t('listLabel')} className="space-y-2">
            {found.items.map((c) => (
              <ConversationRow key={c.id} conversation={c} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('footnote')}</p>
        </div>
      )}
    </Panel>
  );
}

function ConversationRow({ conversation: c }: { conversation: ConversationSummary }) {
  const t = useTranslations('contacts-attributes-tags.contact.conversations');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const last = formatDateTime(c.lastMessageAt, locale, timeZone);
  const assignee = c.assignment.user?.name ?? c.assignment.aiAgent?.name ?? c.assignment.team?.name;
  const title = c.title || c.peerName || c.peerKey;
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-sm font-medium" dir="auto">
              {title}
            </span>
            {c.unreadCount > 0 && (
              <Badge tone="danger">
                <span aria-hidden="true">{c.unreadCount}</span>
                <span className="sr-only">{t('unread', { count: c.unreadCount })}</span>
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
            {c.channel.name}
            <span className="mx-1" aria-hidden="true">
              &middot;
            </span>
            {c.channel.kind}
          </p>
        </div>
        <Link
          href={`/inbox?c=${c.id}`}
          aria-label={t('openLabel', { title })}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('open')}
        </Link>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground" dir="auto">
        {c.preview ? c.preview : t('noPreview')}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Badge>{statusLabel(t, c.status)}</Badge>
        {last && <span>{t('lastMessage', { time: last })}</span>}
        <span dir="auto">{assignee ? t('assignedTo', { name: assignee }) : t('unassigned')}</span>
      </div>
    </li>
  );
}
