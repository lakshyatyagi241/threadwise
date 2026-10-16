'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useToast, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useCanPickCompany } from '@/features/companies';
import { TaskFormModal } from '@/features/tasks';
import { deleteContact, invalidateContacts } from '../../api/contacts';
import { useChannels, openConversation } from '../../api/single-send';
import type { ContactRow } from '../../api/schemas';
import { displayName } from '../../lib/contact-model';
import { quickActions } from '../../lib/row-actions';
import { rowView } from '../../lib/row-view';
import { whatsappChannels, type SendChannel } from '../../lib/single-send';
import type { SectionId } from '../../lib/sections';
import { ContactFormModal } from '../contact-form-modal';
import { DeleteHistoryOption } from '../delete-history-option';
import {
  BuildingIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  MailIcon,
  MoreIcon,
  NoteIcon,
  PencilIcon,
  PhoneIcon,
  TrashIcon,
  WhatsAppIcon,
} from '../icons';
import { SingleSendDrawer, type SingleSendTarget } from '../single-send-drawer';
import { CompanyDialog } from './company-dialog';
import { MeetingDialog } from './meetings-section';
import { useRefreshContact } from './shared';

const pill =
  'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[13px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
const round =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The row of things to do with a contact, under the header of the quick view and of the details page: Note, Task, Meeting, Add (or
 * change) company, the four channels (WhatsApp, email, chat, call) and a "..." menu (edit, delete). Each is drawn only where the
 * person holds its permission (the server checks again), and a channel the contact cannot be reached on is disabled with the reason
 * as its tooltip, not hidden. It owns every dialog it opens, so both screens get the same behaviour from one place.
 */
export function ContactActionBar({
  contact,
  onOpenSection,
  onDeleted,
  className,
}: {
  contact: ContactRow;
  /** Moves the screen to a section: the Note button opens Notes with the composer ready. */
  onOpenSection: (section: SectionId, opts?: { composer?: boolean }) => void;
  /** After the contact was deleted from the "..." menu: leave the screen. */
  onDeleted: () => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.actions');
  const tl = useTranslations('contacts-attributes-tags.list');
  const ts = useTranslations('contacts-attributes-tags.singleSend');
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const canDelete = useCan('record.contacts.delete');
  const canTask = useCan('record.tasks.create');
  const canSend = useCan('inbox.conversation.reply');
  const canCall = useCan('call.calls.use');
  const canPickCompany = useCanPickCompany();
  const refresh = useRefreshContact(contact.id);
  const qc = useQueryClient();
  const router = useRouter();
  const channels = useChannels(canSend);

  const [taskOpen, setTaskOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keepHistory, setKeepHistory] = useState(false);
  const [target, setTarget] = useState<SingleSendTarget | null>(null);

  const name = displayName(contact) || tl('unnamed');
  const row = useMemo(() => rowView(contact, new Map()), [contact]);
  const links = quickActions(row);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);

  const send = (channel: SendChannel) => setTarget({ row, channel });

  /** Chat: open the conversation on the one connected number and go to it; with several numbers the drawer lets the person pick. */
  const chat = useMutation({
    mutationFn: async () => {
      if (numbers.length !== 1) return null;
      return openConversation(contact.id, numbers[0]!.id);
    },
    onSuccess: (opened) => {
      if (opened) router.push(`/inbox?c=${opened.id}`);
      else send('whatsapp');
    },
    onError: () => toast(ts('openFailed', { message: '' }), 'danger'),
  });

  const remove = useMutation({
    mutationFn: () => deleteContact(contact.id, { eraseHistory: !keepHistory }),
    onSuccess: async () => {
      setDeleting(false);
      await invalidateContacts(qc);
      toast(tl('deleted'), 'success');
      onDeleted();
    },
    onError: () => {
      setDeleting(false);
      toast(t('deleteFailed'), 'danger');
    },
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {canUpdate && (
        <button
          type="button"
          className={pill}
          onClick={() => onOpenSection('notes', { composer: true })}
        >
          <NoteIcon className="size-4" />
          {t('note')}
        </button>
      )}
      {canTask && (
        <button type="button" className={pill} onClick={() => setTaskOpen(true)}>
          <CheckIcon className="size-4" />
          {t('task')}
        </button>
      )}
      {canUpdate && (
        <button type="button" className={pill} onClick={() => setMeetingOpen(true)}>
          <CalendarIcon className="size-4" />
          {t('meeting')}
        </button>
      )}
      {canUpdate && canPickCompany && (
        <button type="button" className={pill} onClick={() => setCompanyOpen(true)}>
          <BuildingIcon className="size-4" />
          {contact.companyId ? t('changeCompany') : t('addCompany')}
        </button>
      )}

      {canSend && (
        <span role="group" aria-label={t('channels')} className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!links.whatsapp}
            title={links.whatsapp ? ts('title.whatsapp') : tl('noWhatsapp')}
            aria-label={links.whatsapp ? tl('whatsappNamed', { name }) : tl('noWhatsapp')}
            onClick={() => send('whatsapp')}
            className={cn(
              round,
              'border-success/40 bg-success/10 text-success hover:bg-success/20',
            )}
          >
            <WhatsAppIcon className="size-4" />
          </button>
          <button
            type="button"
            disabled={!links.email}
            title={links.email ? ts('title.email') : tl('noEmail')}
            aria-label={links.email ? tl('emailNamed', { name }) : tl('noEmail')}
            onClick={() => send('email')}
            className={cn(
              round,
              'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
            )}
          >
            <MailIcon className="size-4" />
          </button>
          <button
            type="button"
            disabled={!links.whatsapp || chat.isPending}
            title={links.whatsapp ? tl('openChat') : tl('noWhatsapp')}
            aria-label={links.whatsapp ? tl('chatNamed', { name }) : tl('noWhatsapp')}
            onClick={() => chat.mutate()}
            className={cn(round, 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20')}
          >
            <ChatIcon className="size-4" />
          </button>
        </span>
      )}
      {canCall && (
        <button
          type="button"
          disabled={!links.call}
          title={links.call ? ts('title.call') : tl('noPhone')}
          aria-label={links.call ? tl('callNamed', { name }) : tl('noPhone')}
          onClick={() => send('call')}
          className={cn(round, 'border-border bg-muted text-muted-foreground hover:bg-muted/70')}
        >
          <PhoneIcon className="size-4" />
        </button>
      )}

      {(canUpdate || canDelete) && (
        <span className="ms-auto">
          <Menu
            label={t('more')}
            align="end"
            triggerClassName="size-8 px-0 text-muted-foreground"
            triggerProps={{ 'aria-label': t('more'), title: t('more') }}
            trigger={<MoreIcon />}
          >
            {canUpdate && (
              <MenuItem onSelect={() => setEditing(true)}>
                <PencilIcon /> {t('edit')}
              </MenuItem>
            )}
            {canUpdate && canDelete && <MenuSeparator />}
            {canDelete && (
              <MenuItem danger onSelect={() => setDeleting(true)}>
                <TrashIcon /> {t('delete')}
              </MenuItem>
            )}
          </Menu>
        </span>
      )}

      {taskOpen && (
        <TaskFormModal
          link={{ contact: { id: contact.id, label: name } }}
          onClose={() => setTaskOpen(false)}
          onSaved={() => {
            setTaskOpen(false);
            void refresh();
          }}
        />
      )}
      <MeetingDialog
        open={meetingOpen}
        contactId={contact.id}
        onClose={() => setMeetingOpen(false)}
      />
      <CompanyDialog open={companyOpen} contact={contact} onClose={() => setCompanyOpen(false)} />
      <ContactFormModal open={editing} contact={contact} onClose={() => setEditing(false)} />
      <SingleSendDrawer target={target} onClose={() => setTarget(null)} />
      <ConfirmDialog
        open={deleting}
        tone="danger"
        busy={remove.isPending}
        title={tl('deleteTitle')}
        message={
          <>
            <p>{tl('deleteMessage', { name })}</p>
            <DeleteHistoryOption keepHistory={keepHistory} onChange={setKeepHistory} />
          </>
        }
        confirmLabel={tl('delete')}
        cancelLabel={tl('keep')}
        onClose={() => {
          setDeleting(false);
          setKeepHistory(false);
        }}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
