'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useToast, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useCanPickCompany } from '@/features/companies';
import { useCanLogCall } from '../../api/call-log';
import type { ContactTouchChannel } from '@crm/contracts';
import { clearFollowUp, reportContactTouch, setUncontacted } from '../../api/lead-handling';
import { deleteContact, invalidateContacts } from '../../api/contacts';
import { useChannels, openConversation } from '../../api/single-send';
import type { ContactRow } from '../../api/schemas';
import { displayName } from '../../lib/contact-model';
import { messageRoute, quickActions } from '../../lib/row-actions';
import { rowView } from '../../lib/row-view';
import { emailChannels, whatsappChannels, type SendChannel } from '../../lib/single-send';
import { sectionAllowed, SECTION_OF_TARGET, type AddTarget } from '../../lib/sections';
import { ContactFormModal } from '../contact-form-modal';
import { DeleteHistoryOption } from '../delete-history-option';
import {
  BuildingIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  HistoryIcon,
  MailIcon,
  MoreIcon,
  NoteIcon,
  PencilIcon,
  PhoneIcon,
  TrashIcon,
  WhatsAppIcon,
} from '../icons';
import { SingleSendDrawer, type SingleSendTarget } from '../single-send-drawer';
import { notifyCallClick, rememberPhoneClick } from './call-nudge';
import { FieldHistoryDrawer } from './field-history';
import { ContactPrivacyMenuItems } from '@/features/privacy-requests';
import { FollowUpDialog } from '../lead-handling/next-follow-up';

const button =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap border border-border bg-background px-2.5 text-[13px] font-medium outline-none transition hover:bg-muted focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

/** A button that is a label on a wide screen and only its icon on a phone, so the one row of actions never wraps. */
function Label({ children }: { children: ReactNode }) {
  return <span className="max-sm:sr-only">{children}</span>;
}

/**
 * A button with a menu beside it (a "split button"): the button does the usual thing, the small arrow offers the other ways.
 * Without any other way it is just the button.
 */
function Split({
  main,
  menu,
  menuLabel,
}: {
  main: ReactNode;
  menu: ReactNode[];
  menuLabel: string;
}) {
  if (menu.length === 0) return <>{main}</>;
  return (
    <span className="inline-flex">
      {main}
      <Menu
        label={menuLabel}
        align="start"
        placement="fixed"
        triggerClassName="h-9 w-7 gap-0 rounded-s-none rounded-e-md border-s-0 px-0 text-muted-foreground"
        triggerProps={{ 'aria-label': menuLabel, title: menuLabel }}
        trigger={<ChevronDownIcon className="size-3.5" />}
      >
        {menu}
      </Menu>
    </span>
  );
}

/**
 * The ONE row of things to do with a contact, under the header of the quick view and of the details page: Note, Task, Call, Meeting,
 * Message and a "..." menu (edit, add or change company, field history, delete). Each is drawn only where the person holds its
 * permission (the server checks again), and what the contact cannot be reached on is disabled with the reason as its tooltip, not
 * hidden.
 *
 * Note, Task, Meeting and Call are shortcuts: no dialog opens, `onAdd` moves the screen to the Activity tab's compose box and puts the
 * cursor in that tab. Call starts a call in the best way there is (a WhatsApp call, else the phone through a `tel:` link) and its menu
 * offers the others and "Log a call"; Message opens the WhatsApp chat (else the mailbox) and its menu offers the template message
 * and e-mail. The edit form, the send drawer and the delete confirmation are the dialogs it still owns.
 */
export function ContactActionBar({
  contact,
  onAdd,
  onDeleted,
  className,
  variant = 'row',
}: {
  contact: ContactRow;
  /** `row`: labelled buttons in one row (the quick view). `round`: the profile card's centered row of round icons with a small label under each. */
  variant?: 'row' | 'round';
  /** Note, Task, Call, Meeting and Add company: show that composer with the cursor in it. */
  onAdd: (target: AddTarget) => void;
  /** After the contact was deleted from the "..." menu: leave the screen. */
  onDeleted: () => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.actions');
  const tr = useTranslations('contacts-attributes-tags.contact.record.actions');
  const tl = useTranslations('contacts-attributes-tags.list');
  const ts = useTranslations('contacts-attributes-tags.singleSend');
  const tu = useTranslations('contacts-attributes-tags.leadHandling.uncontacted');
  const tfu = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const canDelete = useCan('record.contacts.delete');
  const canTask = useCan('record.tasks.create');
  const canSend = useCan('inbox.conversation.reply');
  const canCall = useCan('call.calls.use');
  const canLogCall = useCanLogCall();
  const canPickCompany = useCanPickCompany();
  const { permissions } = useSession();
  const tasksOpen = sectionAllowed(SECTION_OF_TARGET.task, (p) => p in permissions);
  const qc = useQueryClient();
  const router = useRouter();
  const channels = useChannels(canSend);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [keepHistory, setKeepHistory] = useState(false);
  const [target, setTarget] = useState<SingleSendTarget | null>(null);

  const name = displayName(contact) || tl('unnamed');
  const row = useMemo(() => rowView(contact, new Map()), [contact]);
  const links = quickActions(row);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);
  const mailboxes = useMemo(() => emailChannels(channels.data?.data ?? []), [channels.data]);

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

  const mark = useMutation({
    mutationFn: (uncontacted: boolean) => setUncontacted(contact.id, uncontacted),
    onSuccess: async (r) => {
      await invalidateContacts(qc);
      toast(r.uncontacted ? tu('markedUncontacted') : tu('markedContacted'), 'success');
    },
    onError: () => toast(tu('markFailed'), 'danger'),
  });

  const removeFollowUp = useMutation({
    mutationFn: () => clearFollowUp(contact.id),
    onSuccess: async () => {
      await invalidateContacts(qc);
      toast(tfu('clearedMessage'), 'success');
    },
    onError: () => toast(tfu('failed'), 'danger'),
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

  // --- Call: the best way there is is the button, the other ways are in the menu ------------------------------------------
  type CallWay = 'whatsapp' | 'phone' | 'log';
  const callWays: CallWay[] = [
    ...(canCall && links.call !== null ? (['whatsapp'] as const) : []),
    ...(links.call !== null ? (['phone'] as const) : []),
    ...(canLogCall ? (['log'] as const) : []),
  ];
  const [callMain, ...callOthers] = callWays;
  const callIcon: Record<CallWay, ReactNode> = {
    whatsapp: <WhatsAppIcon />,
    phone: <PhoneIcon />,
    log: <NoteIcon />,
  };
  const callText: Record<CallWay, string> = {
    whatsapp: tr('callWhatsapp'),
    phone: tr('callPhone'),
    log: tr('logCall'),
  };
  /** The person pressed a contact button: the workspace's lead handling settings decide whether that marks the contact as contacted. */
  const pressed = (channel: ContactTouchChannel) => {
    if (!canUpdate) return;
    reportContactTouch(
      contact.id,
      channel,
      contact.uncontactedSince ? () => void invalidateContacts(qc) : undefined,
    );
  };
  const runCall = (way: CallWay) => {
    if (way !== 'log') pressed('call');
    if (way === 'whatsapp') send('call');
    else if (way === 'log') onAdd('call');
    else {
      // A `tel:` link is handed to the phone or the desktop dialer: nothing tells us whether the call was made, so the click is
      // remembered and the person is asked afterwards ("How did the call go?").
      if (canLogCall) {
        rememberPhoneClick(contact.id);
        notifyCallClick();
      }
      window.location.assign(links.call!);
    }
  };
  const callMenu = callOthers.map((way) => (
    <MenuItem key={way} onSelect={() => runCall(way)}>
      {callIcon[way]} {callText[way]}
    </MenuItem>
  ));
  const showCall = canCall || canLogCall;
  const callLabel = callMain === 'log' ? tr('logCall') : tr('call');

  // --- Message: the chat (else the mailbox) is the button, the template message and e-mail are in the menu ----------------
  type MessageWay = 'chat' | 'template' | 'email';
  const route = messageRoute(
    row,
    channels.isSuccess ? { whatsapp: numbers.length > 0, email: mailboxes.length > 0 } : undefined,
  );
  const messageBlocked = route.kind === 'blocked';
  const whyNoMessage = route.kind === 'blocked' ? tl(`noMessage_${route.reason}`) : '';
  const messageOthers: MessageWay[] = [
    ...(links.whatsapp && route.kind !== 'chat' ? (['chat'] as const) : []),
    ...(links.whatsapp ? (['template'] as const) : []),
    ...(links.email && route.kind !== 'email' ? (['email'] as const) : []),
  ];
  const runMessage = (way: MessageWay) => {
    pressed(way === 'email' ? 'email' : 'whatsapp');
    if (way === 'chat') chat.mutate();
    else if (way === 'template') send('whatsapp');
    else send('email');
  };
  const messageIcon: Record<MessageWay, ReactNode> = {
    chat: <ChatIcon />,
    template: <WhatsAppIcon />,
    email: <MailIcon />,
  };
  const messageText: Record<MessageWay, string> = {
    chat: tr('messageChat'),
    template: tr('messageTemplate'),
    email: tr('messageEmail'),
  };
  const messageMenu = messageOthers.map((way) => (
    <MenuItem key={way} onSelect={() => runMessage(way)}>
      {messageIcon[way]} {messageText[way]}
    </MenuItem>
  ));
  const messageMain = () => {
    if (route.kind !== 'blocked') pressed(route.kind === 'email' ? 'email' : 'whatsapp');
    if (route.kind === 'chat') chat.mutate();
    else if (route.kind === 'email') send('email');
  };

  // The "..." menu's items: the same in both looks.
  const moreItems = (
    <>
      {canUpdate && (
        <MenuItem onSelect={() => setEditing(true)}>
          <PencilIcon /> {t('edit')}
        </MenuItem>
      )}
      {canUpdate && canPickCompany && (
        <MenuItem onSelect={() => onAdd('company')}>
          <BuildingIcon /> {contact.companyId ? t('changeCompany') : t('addCompany')}
        </MenuItem>
      )}
      {canUpdate && (
        <MenuItem onSelect={() => mark.mutate(!contact.uncontactedSince)}>
          <CheckIcon /> {contact.uncontactedSince ? tu('markContacted') : tu('markUncontacted')}
        </MenuItem>
      )}
      {canUpdate && (
        <MenuItem onSelect={() => setFollowUpOpen(true)}>
          <ClockIcon /> {contact.nextFollowUp ? tfu('edit') : tfu('set')}
        </MenuItem>
      )}
      {canUpdate && contact.nextFollowUp && (
        <MenuItem onSelect={() => removeFollowUp.mutate()}>
          <ClockIcon /> {tfu('remove')}
        </MenuItem>
      )}
      <MenuItem onSelect={() => setHistory(true)}>
        <HistoryIcon /> {tr('fieldHistory')}
      </MenuItem>
      <ContactPrivacyMenuItems contactId={contact.id} />
      {canDelete && <MenuSeparator />}
      {canDelete && (
        <MenuItem danger onSelect={() => setDeleting(true)}>
          <TrashIcon /> {t('delete')}
        </MenuItem>
      )}
    </>
  );
  const overlays = (
    <>
      <ContactFormModal open={editing} contact={contact} onClose={() => setEditing(false)} />
      {followUpOpen && (
        <FollowUpDialog
          contactId={contact.id}
          current={contact.nextFollowUp}
          open
          onClose={() => setFollowUpOpen(false)}
        />
      )}
      <FieldHistoryDrawer open={history} onClose={() => setHistory(false)} contactId={contact.id} />
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
    </>
  );

  if (variant === 'round') {
    const callItems = callWays.map((way) => (
      <MenuItem key={way} onSelect={() => runCall(way)}>
        {callIcon[way]} {callText[way]}
      </MenuItem>
    ));
    const messageWays: MessageWay[] = [
      ...(route.kind === 'chat'
        ? (['chat'] as const)
        : route.kind === 'email'
          ? (['email'] as const)
          : []),
      ...messageOthers,
    ];
    const messageItems = messageWays.map((way) => (
      <MenuItem key={way} onSelect={() => runMessage(way)}>
        {messageIcon[way]} {messageText[way]}
      </MenuItem>
    ));
    return (
      <div
        role="group"
        aria-label={tr('label')}
        className={cn('flex flex-wrap items-start justify-between gap-y-2', className)}
      >
        {canUpdate && (
          <RoundAction label={t('note')}>
            <button
              type="button"
              className={roundButton}
              onClick={() => onAdd('note')}
              title={t('note')}
              aria-label={t('note')}
            >
              <NoteIcon className="size-4" />
            </button>
          </RoundAction>
        )}
        {canSend && (
          <RoundAction label={tr('message')}>
            {messageItems.length > 1 ? (
              <Menu
                label={tr('messageMore')}
                placement="fixed"
                triggerClassName={roundMenu}
                triggerProps={{ 'aria-label': tr('message'), title: tr('message') }}
                trigger={<ChatIcon className="size-4" />}
              >
                {messageItems}
              </Menu>
            ) : (
              <button
                type="button"
                disabled={messageBlocked || chat.isPending}
                title={messageBlocked ? whyNoMessage : tr('message')}
                aria-label={messageBlocked ? whyNoMessage : tr('message')}
                onClick={messageMain}
                className={roundButton}
              >
                <ChatIcon className="size-4" />
              </button>
            )}
          </RoundAction>
        )}
        {showCall && (
          <RoundAction label={tr('call')}>
            {callItems.length > 1 ? (
              <Menu
                label={tr('callMore')}
                placement="fixed"
                triggerClassName={roundMenu}
                triggerProps={{ 'aria-label': tr('call'), title: tr('call') }}
                trigger={<PhoneIcon className="size-4" />}
              >
                {callItems}
              </Menu>
            ) : (
              <button
                type="button"
                disabled={callMain === undefined}
                title={callMain === undefined ? tl('noPhone') : callLabel}
                aria-label={callMain === undefined ? tl('noPhone') : callLabel}
                onClick={() => callMain && runCall(callMain)}
                className={roundButton}
              >
                <PhoneIcon className="size-4" />
              </button>
            )}
          </RoundAction>
        )}
        {canTask && tasksOpen && (
          <RoundAction label={t('task')}>
            <button
              type="button"
              className={roundButton}
              onClick={() => onAdd('task')}
              title={t('task')}
              aria-label={t('task')}
            >
              <CheckIcon className="size-4" />
            </button>
          </RoundAction>
        )}
        {canUpdate && (
          <RoundAction label={t('meeting')}>
            <button
              type="button"
              className={roundButton}
              onClick={() => onAdd('meeting')}
              title={t('meeting')}
              aria-label={t('meeting')}
            >
              <CalendarIcon className="size-4" />
            </button>
          </RoundAction>
        )}
        <RoundAction label={tr('more')}>
          <Menu
            label={t('more')}
            placement="fixed"
            triggerClassName={roundMenu}
            triggerProps={{ 'aria-label': t('more'), title: t('more') }}
            trigger={<MoreIcon className="size-4" />}
          >
            {moreItems}
          </Menu>
        </RoundAction>
        {overlays}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2 max-sm:flex-nowrap', className)}>
      <span
        role="group"
        aria-label={tr('label')}
        className="thin-scrollbar flex min-w-0 flex-1 items-center gap-1.5 max-sm:overflow-x-auto"
      >
        {canUpdate && (
          <button
            type="button"
            className={cn(button, 'rounded-md')}
            onClick={() => onAdd('note')}
            title={t('note')}
          >
            <NoteIcon className="size-4" />
            <Label>{t('note')}</Label>
          </button>
        )}
        {canTask && tasksOpen && (
          <button
            type="button"
            className={cn(button, 'rounded-md')}
            onClick={() => onAdd('task')}
            title={t('task')}
          >
            <CheckIcon className="size-4" />
            <Label>{t('task')}</Label>
          </button>
        )}
        {showCall && (
          <Split
            menuLabel={tr('callMore')}
            menu={callMenu}
            main={
              <button
                type="button"
                disabled={callMain === undefined}
                title={callMain === undefined ? tl('noPhone') : callLabel}
                aria-label={callMain === undefined ? tl('noPhone') : callLabel}
                onClick={() => callMain && runCall(callMain)}
                className={cn(
                  button,
                  callMenu.length > 0 ? 'rounded-s-md rounded-e-none' : 'rounded-md',
                )}
              >
                <PhoneIcon className="size-4" />
                <Label>{callLabel}</Label>
              </button>
            }
          />
        )}
        {canUpdate && (
          <button
            type="button"
            className={cn(button, 'rounded-md')}
            onClick={() => onAdd('meeting')}
            title={t('meeting')}
          >
            <CalendarIcon className="size-4" />
            <Label>{t('meeting')}</Label>
          </button>
        )}
        {canSend && (
          <Split
            menuLabel={tr('messageMore')}
            menu={messageMenu}
            main={
              <button
                type="button"
                disabled={messageBlocked || chat.isPending}
                title={messageBlocked ? whyNoMessage : tr('message')}
                aria-label={messageBlocked ? whyNoMessage : tl('messageNamed', { name })}
                onClick={messageMain}
                className={cn(
                  button,
                  messageMenu.length > 0 ? 'rounded-s-md rounded-e-none' : 'rounded-md',
                  'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20 dark:text-primary',
                )}
              >
                <ChatIcon className="size-4" />
                <Label>{tr('message')}</Label>
              </button>
            }
          />
        )}
      </span>

      <span className="shrink-0">
        <Menu
          label={t('more')}
          align="end"
          placement="fixed"
          triggerClassName="size-9 px-0 text-muted-foreground"
          triggerProps={{ 'aria-label': t('more'), title: t('more') }}
          trigger={<MoreIcon />}
        >
          {moreItems}
        </Menu>
      </span>

      {overlays}
    </div>
  );
}

const roundButton =
  'inline-flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
const roundMenu =
  'size-9 gap-0 rounded-full border-border bg-background px-0 text-foreground hover:bg-muted';

/** A round icon with its small name under it (HubSpot's profile card row). */
function RoundAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex w-11 flex-col items-center gap-1">
      {children}
      <span className="max-w-full truncate text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
    </span>
  );
}
