'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Popover } from '@crm/ui';
import type { InboxConversationDetail } from '@crm/contracts';
import { TagChip } from './tag-chip';
import { TagMenu } from './tag-menu';

export interface TagGroupsProps {
  detail: InboxConversationDetail;
  /** The linked contact's id, null for a thread with no contact record. */
  contactId: string | null;
  /** May the person edit the contact (`record.contacts.update`)? Then the contact tags link to the contact to change them. */
  canEditContact: boolean;
  /** Present when the person may put tags on threads (`inbox.conversation.tag`). */
  tags?: {
    busy: boolean;
    canCreate: boolean;
    onApply: (input: { tagId: string } | { name: string }) => void;
    onWithdraw: (tagId: string) => void;
  };
}

/** A "?" that opens a one-line explanation. It opens on click, Enter or Space and closes on Escape or a press outside. */
function InfoTip({ title, text }: { title: string; text: string }) {
  const t = useTranslations('team-inbox-conversations.tags.groups');
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('helpFor', { title })}
        title={text}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold leading-none text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        ?
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={title}
        className="start-0 end-auto w-60"
      >
        <p className="text-xs text-foreground">{text}</p>
      </Popover>
    </span>
  );
}

/**
 * The side panel's two tag groups, kept apart on purpose. A CONTACT tag describes the person (VIP, lead, region) and follows them
 * into every conversation; it is read-only here, with a link to the contact to change it. A CONVERSATION tag describes this
 * thread (billing, refund, urgent) and is added and removed here. Both come from the same workspace tag library.
 */
export function TagGroups({ detail, contactId, canEditContact, tags }: TagGroupsProps) {
  const t = useTranslations('team-inbox-conversations.tags.groups');
  const contactTags = detail.contactSummary?.contactTags ?? [];

  return (
    <section
      aria-label={t('title')}
      className="space-y-3 text-start"
      data-testid="inbox-tag-groups"
    >
      <div data-testid="inbox-contact-tags" className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold">{t('contactTitle')}</h4>
          <InfoTip title={t('contactTitle')} text={t('contactHelp')} />
          {contactId && canEditContact && (
            <Link
              href={`/contacts/${contactId}`}
              data-testid="inbox-contact-tags-edit"
              className="ms-auto text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('contactEdit')}
            </Link>
          )}
        </div>
        {contactTags.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {contactTags.map((c) => (
              <li key={c.id}>
                <TagChip tag={c} className="max-w-[12rem] text-xs" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t('contactNone')}</p>
        )}
      </div>

      <div data-testid="inbox-conversation-tags" className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold">{t('conversationTitle')}</h4>
          <InfoTip title={t('conversationTitle')} text={t('conversationHelp')} />
          {tags && (
            <span className="ms-auto">
              <TagMenu
                applied={detail.labels}
                busy={tags.busy}
                canCreate={tags.canCreate}
                onApply={tags.onApply}
                onWithdraw={tags.onWithdraw}
              />
            </span>
          )}
        </div>
        {detail.labels.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {detail.labels.map((l) => (
              <li key={l.id} className="inline-flex items-center gap-0.5">
                <TagChip tag={l} className="max-w-[12rem] text-xs" />
                {tags && (
                  <button
                    type="button"
                    disabled={tags.busy}
                    aria-label={t('remove', { name: l.name })}
                    onClick={() => tags.onWithdraw(l.id)}
                    className="rounded-full px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t('conversationNone')}</p>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">{t('rule')}</p>
    </section>
  );
}
