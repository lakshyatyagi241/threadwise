'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Drawer, Input, Select, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CallButton, useCallEligibility, useDirectCall } from '@/features/calling-voice';
import {
  openConversation,
  sendEmail,
  sendTemplate,
  useChannels,
  useConversationTemplates,
  useOpenConversation,
} from '../api/single-send';
import {
  emailChannels,
  missingSlots,
  previewOf,
  sendBlock,
  whatsappChannels,
  type SendChannel,
} from '../lib/single-send';
import type { RowView } from '../lib/row-view';
import { isMaskedPhone } from '../lib/row-actions';
import { MailIcon, PhoneIcon, SmsIcon, WhatsAppIcon } from './icons';

const NS = 'contacts-attributes-tags.singleSend';

const ICON: Record<SendChannel, typeof PhoneIcon> = {
  whatsapp: WhatsAppIcon,
  sms: SmsIcon,
  email: MailIcon,
  call: PhoneIcon,
};

export interface SingleSendTarget {
  row: RowView;
  channel: SendChannel;
}

/**
 * "Single send" (one contact, one channel) as a drawer from the list's quick-action icons. WhatsApp sends one approved template, with
 * its variables filled in and a live preview; a contact that opted out sees why instead of a form. Call places a WhatsApp call from the
 * browser. SMS and email have no sender behind them yet: the drawer says so and hands over to the person's own app.
 */
export function SingleSendDrawer({
  target,
  onClose,
}: {
  target: SingleSendTarget | null;
  onClose: () => void;
}) {
  // A call has no form to fill: with one connected number the call starts at once, with no drawer in between.
  if (target?.channel === 'call') return <CallEntry target={target} onClose={onClose} />;
  return <SendDrawer target={target} onClose={onClose} />;
}

/**
 * The call icon of a contact row. With exactly one connected WhatsApp number (and a phone on the contact) the call starts straight
 * away; with several numbers the person still picks one in the drawer, and a contact with no phone sees why there.
 */
function CallEntry({ target, onClose }: { target: SingleSendTarget; onClose: () => void }) {
  const channels = useChannels(true);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);
  // Nothing is drawn while the numbers load, so a call that starts at once never flashes a drawer.
  if (channels.isPending) return null;
  if (numbers.length === 1 && !sendBlock('call', target.row))
    return (
      <DirectCall key={target.row.id} row={target.row} numberId={numbers[0]!.id} onDone={onClose} />
    );
  return <SendDrawer target={target} onClose={onClose} />;
}

/** Opens the conversation on the number, places the call (or sends the permission request) and closes. Renders nothing. */
/** One direct call is placed at a time; a second click while it starts is ignored. */
let directCallRunning = false;

function DirectCall({
  row,
  numberId,
  onDone,
}: {
  row: RowView;
  numberId: string;
  onDone: () => void;
}) {
  const t = useTranslations(NS);
  const { toast } = useToast();
  const call = useDirectCall();
  const canCall = useCan('call.calls.use');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!canCall) {
      toast(t('callOff'), 'danger');
      onDone();
      return;
    }
    if (directCallRunning) {
      onDone();
      return;
    }
    directCallRunning = true;
    void (async () => {
      try {
        const conversation = await openConversation(row.id, numberId);
        const result = await call({
          conversationId: conversation.id,
          displayName: row.name,
          contactId: row.id,
        });
        if (result === 'disabled') toast(t('callOff'), 'danger');
      } catch (err) {
        toast(t('openFailed', { message: err instanceof Error ? err.message : '' }), 'danger');
      } finally {
        directCallRunning = false;
        onDone();
      }
    })();
    // The call starts once for this row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SendDrawer({ target, onClose }: { target: SingleSendTarget | null; onClose: () => void }) {
  const t = useTranslations(NS);
  const Icon = target ? ICON[target.channel] : WhatsAppIcon;
  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-5" />
          {target ? t(`title.${target.channel}`) : ''}
        </span>
      }
      closeLabel={t('close')}
      className="w-[min(37.5rem,100vw)]"
    >
      {target && (
        <Body key={`${target.row.id}:${target.channel}`} target={target} onClose={onClose} />
      )}
    </Drawer>
  );
}

function Body({ target, onClose }: { target: SingleSendTarget; onClose: () => void }) {
  const t = useTranslations(NS);
  const { row, channel } = target;
  const block = sendBlock(channel, row);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
        <dt className="text-muted-foreground">{t('name')}</dt>
        <dd className="min-w-0 truncate font-medium">{row.name || '-'}</dd>
        <dt className="text-muted-foreground">{t('phone')}</dt>
        <dd className="min-w-0 truncate" dir="ltr">
          {row.phone || '-'}
        </dd>
        <dt className="text-muted-foreground">{t('email')}</dt>
        <dd className="min-w-0 truncate">{row.email || '-'}</dd>
      </dl>
      {block ? (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          {t(block)}
        </p>
      ) : channel === 'whatsapp' ? (
        <WhatsAppForm row={row} onClose={onClose} />
      ) : channel === 'call' ? (
        <CallPanel row={row} />
      ) : channel === 'email' ? (
        <EmailForm row={row} onClose={onClose} />
      ) : (
        <NotAvailable row={row} channel={channel} />
      )}
    </div>
  );
}

function WhatsAppForm({ row, onClose }: { row: RowView; onClose: () => void }) {
  const t = useTranslations(NS);
  const { toast } = useToast();
  const qc = useQueryClient();
  const channels = useChannels(true);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);
  const [chosenNumber, setNumberId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});

  // One number is the obvious choice; with several the person picks.
  const numberId = chosenNumber || (numbers.length === 1 ? numbers[0]!.id : '');

  const conversation = useOpenConversation(row.id, numberId);
  const templates = useConversationTemplates(conversation.data?.id);
  const picked = templates.data?.data.find((x) => x.id === templateId);
  const missing = picked ? missingSlots(picked, vars) : [];

  const send = useMutation({
    mutationFn: () =>
      sendTemplate(conversation.data!.id, {
        templateId,
        variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.trim()])),
        clientMessageId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      toast(t('sent', { name: row.name || row.phone }), 'success');
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (e) =>
      toast(t('failed', { message: e instanceof Error ? e.message : String(e) }), 'danger'),
  });

  if (channels.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  if (numbers.length === 0)
    return <p className="text-sm text-muted-foreground">{t('noChannel')}</p>;

  const canSend = Boolean(picked?.sendable) && missing.length === 0 && !send.isPending;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      <div className="space-y-1">
        <label htmlFor="ss-number" className="text-sm font-medium">
          {t('number')}
        </label>
        <Select
          id="ss-number"
          value={numberId}
          onChange={(e) => {
            setNumberId(e.target.value);
            setTemplateId('');
            setVars({});
          }}
        >
          {numbers.length > 1 && <option value="">{t('templatePlaceholder')}</option>}
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
              {n.displayAddress ? ` (${n.displayAddress})` : ''}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('numberHint')}</p>
      </div>

      {conversation.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('openFailed', {
            message: conversation.error instanceof Error ? conversation.error.message : '',
          })}
        </p>
      )}

      {numberId && conversation.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}

      {conversation.data && (
        <div className="space-y-1">
          <label htmlFor="ss-template" className="text-sm font-medium">
            {t('template')}
          </label>
          <Select
            id="ss-template"
            value={templateId}
            disabled={templates.isPending}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setVars({});
            }}
          >
            <option value="">{t('templatePlaceholder')}</option>
            {templates.data?.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.language})
              </option>
            ))}
          </Select>
          {templates.data && templates.data.data.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('noTemplates')}</p>
          )}
        </div>
      )}

      {picked && !picked.sendable && (
        <p role="alert" className="text-sm text-danger">
          {t('notSendable', { reason: picked.reason ?? '-' })}
        </p>
      )}

      {picked?.sendable && picked.slots.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('variables')}</legend>
          {picked.slots.map((s) => (
            <div key={s.key} className="space-y-1">
              <label htmlFor={`ss-var-${s.key}`} className="text-xs text-muted-foreground">
                {s.label || t('slot', { key: s.key })}
              </label>
              <Input
                id={`ss-var-${s.key}`}
                value={vars[s.key] ?? ''}
                placeholder={s.example ?? ''}
                onChange={(e) => setVars((o) => ({ ...o, [s.key]: e.target.value }))}
              />
            </div>
          ))}
        </fieldset>
      )}

      {picked?.sendable && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('preview')}</p>
          <div className="whitespace-pre-wrap rounded-lg bg-success/10 p-3 text-sm" dir="auto">
            {picked.header && <p className="mb-1 font-semibold">{picked.header}</p>}
            {previewOf(picked, vars)}
            {picked.footer && <p className="mt-1 text-xs text-muted-foreground">{picked.footer}</p>}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="brand" disabled={!canSend}>
          {send.isPending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}

function CallPanel({ row }: { row: RowView }) {
  const t = useTranslations(NS);
  const canUse = useCan('call.calls.use');
  const channels = useChannels(true);
  const numbers = useMemo(() => whatsappChannels(channels.data?.data ?? []), [channels.data]);
  // The first connected number places the call.
  const numberId = numbers[0]?.id ?? '';

  const conversation = useOpenConversation(row.id, numberId);
  const convId = conversation.data?.id ?? '';
  const eligibility = useCallEligibility(convId, canUse && Boolean(convId));

  if (channels.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  if (numbers.length === 0)
    return <p className="text-sm text-muted-foreground">{t('noChannel')}</p>;

  const e = eligibility.data;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('callIntro')}</p>
      {conversation.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('openFailed', {
            message: conversation.error instanceof Error ? conversation.error.message : '',
          })}
        </p>
      )}
      {(conversation.isPending || (convId && eligibility.isPending)) && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {e && !e.enabled && <p className="text-sm text-warning">{t('callOff')}</p>}
      {e?.enabled && !e.usable && (
        <p className="text-sm text-muted-foreground">{t('callPermission')}</p>
      )}
      {e?.enabled && e.usable && (
        <p className="text-sm text-success">{t('callReady', { phone: row.phone })}</p>
      )}
      {convId && (
        <div>
          {/* Hides itself unless calling is on for this number; it also asks for the customer's permission when none is granted. */}
          <CallButton conversationId={convId} displayName={row.name} contactId={row.id} />
        </div>
      )}
    </div>
  );
}

function NotAvailable({ row, channel }: { row: RowView; channel: 'sms' }) {
  const t = useTranslations(NS);
  // A masked number (no contacts.phone.reveal) is not a real target: an `sms:` link built from it would open the
  // person's messaging app on a meaningless string instead of the contact. Disabled, with the reason, rather than
  // a dead link — the same "disabled, not hidden" rule the list's own quick actions follow (row-actions.ts).
  if (isMaskedPhone(row.phone)) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t(`later.${channel}`)}</p>
        <span
          aria-disabled="true"
          title={t('phoneMasked')}
          aria-label={t('phoneMasked')}
          className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground/40"
        >
          {t(`openApp.${channel}`)}
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t(`later.${channel}`)}</p>
      <a
        href={`sms:${row.phone}`}
        className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
      >
        {t(`openApp.${channel}`)}
      </a>
    </div>
  );
}

function EmailForm({ row, onClose }: { row: RowView; onClose: () => void }) {
  const t = useTranslations(NS);
  const { toast } = useToast();
  const qc = useQueryClient();
  const channels = useChannels(true);
  const mailboxes = useMemo(() => emailChannels(channels.data?.data ?? []), [channels.data]);
  const [chosenMailbox, setMailboxId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // One mailbox is the obvious choice; with several the person picks.
  const mailboxId = chosenMailbox || (mailboxes.length === 1 ? mailboxes[0]!.id : '');
  const conversation = useOpenConversation(row.id, mailboxId);

  const send = useMutation({
    mutationFn: () =>
      sendEmail(conversation.data!.id, {
        subject: subject.trim(),
        body: body.trim(),
        clientMessageId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      toast(t('sent', { name: row.name || row.email }), 'success');
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (e) =>
      toast(t('failed', { message: e instanceof Error ? e.message : String(e) }), 'danger'),
  });

  if (channels.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  if (mailboxes.length === 0)
    return <p className="text-sm text-muted-foreground">{t('noMailbox')}</p>;

  const canSend = Boolean(conversation.data) && subject.trim() !== '' && body.trim() !== '' && !send.isPending;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      <div className="space-y-1">
        <label htmlFor="ss-mailbox" className="text-sm font-medium">
          {t('mailbox')}
        </label>
        <Select
          id="ss-mailbox"
          value={mailboxId}
          onChange={(e) => setMailboxId(e.target.value)}
        >
          {mailboxes.length > 1 && <option value="">{t('mailboxPlaceholder')}</option>}
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.displayAddress ? ` (${m.displayAddress})` : ''}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('mailboxHint')}</p>
      </div>

      {conversation.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('openFailed', {
            message: conversation.error instanceof Error ? conversation.error.message : '',
          })}
        </p>
      )}

      {mailboxId && conversation.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}

      {conversation.data && (
        <>
          <div className="space-y-1">
            <label htmlFor="ss-subject" className="text-sm font-medium">
              {t('subject')}
            </label>
            <Input
              id="ss-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="ss-body" className="text-sm font-medium">
              {t('body')}
            </label>
            <Textarea
              id="ss-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('bodyPlaceholder')}
            />
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="brand" disabled={!canSend}>
          {send.isPending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}
