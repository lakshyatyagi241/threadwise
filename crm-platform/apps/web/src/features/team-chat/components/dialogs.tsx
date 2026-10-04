'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import {
  TCHAT_CHANNEL_DESCRIPTION_MAX,
  TCHAT_CHANNEL_NAME_MAX,
  type TchatChannelResponse,
  type TchatInvitationResponse,
  type TchatMember,
} from '@crm/contracts';
import { useChannelMembers, useInvitations, refreshInvitations, KEYS } from '../api/hooks';
import { chatApi } from '../api/service';
import { formatStamp } from '../lib/format';
import { Avatar, useErrorText, useNow } from './parts';

const NAME_PATTERN = '[A-Za-z0-9][A-Za-z0-9_\\-]*';

/** "Create a channel": name, description, public or private (TW-TCHAT-004). */
function CreateChannelForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (channel: TchatChannelResponse) => void;
}) {
  const t = useTranslations('team-chat.createChannel');
  const errorText = useErrorText();
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const channel = await chatApi.createChannel({
        name: name.trim(),
        description: description.trim() || null,
        type,
      });
      onCreated(channel);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t('name')} htmlFor={`${id}-name`} hint={t('nameHint')}>
        <div className="flex items-center">
          <span
            aria-hidden="true"
            className="rounded-s-md border border-e-0 border-border bg-muted px-2 py-2 text-[13px] text-muted-foreground"
          >
            #
          </span>
          <Input
            className="rounded-s-none"
            placeholder={t('namePlaceholder')}
            id={`${id}-name`}
            value={name}
            required
            maxLength={TCHAT_CHANNEL_NAME_MAX}
            pattern={NAME_PATTERN}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </Field>
      <Field label={t('description')} htmlFor={`${id}-desc`}>
        <Input
          id={`${id}-desc`}
          value={description}
          maxLength={TCHAT_CHANNEL_DESCRIPTION_MAX}
          placeholder={t('descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('privacy')}
        </legend>
        <div className="flex gap-2">
          {(['public', 'private'] as const).map((v) => (
            <label
              key={v}
              className={cn(
                'flex-1 cursor-pointer rounded-md border px-3 py-2 hover:border-primary',
                type === v ? 'border-primary bg-success/10' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={`${id}-type`}
                checked={type === v}
                onChange={() => setType(v)}
                className="me-1.5"
              />
              {t(`${v}.label`)}
              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                {t(`${v}.hint`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Spinner />}
          {t('create')}
        </Button>
      </div>
    </form>
  );
}

/** "Create a channel": name, description, public or private (TW-TCHAT-004). The form is mounted only while open, so it starts empty each time. */
export function CreateChannelDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: TchatChannelResponse) => void;
}) {
  const t = useTranslations('team-chat.createChannel');
  return (
    <Modal open={open} onClose={onClose} title={t('title')} closeLabel={t('close')}>
      {open && <CreateChannelForm onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

/** "Invite a teammate": an email, an optional name and note, and optionally the private channel to add them to. */
function InviteForm({
  onClose,
  channel,
}: {
  onClose: () => void;
  channel: TchatChannelResponse | null;
}) {
  const t = useTranslations('team-chat.invite');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const id = useId();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [toChannel, setToChannel] = useState(false);
  const [result, setResult] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const targetable = channel?.type === 'private';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const out = await chatApi.invite({
        inviteeEmail: email,
        inviteeName: name || null,
        note: note || null,
        channelId: toChannel && targetable ? channel!.id : null,
      });
      setResult({
        tone: out.status === 'approved' ? 'success' : 'warning',
        text: out.status === 'approved' ? t('approved') : t('pending'),
      });
      await refreshInvitations(qc);
      window.setTimeout(onClose, 1500);
    } catch (err) {
      setResult({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  const tone = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t('email')} htmlFor={`${id}-email`}>
        <Input
          id={`${id}-email`}
          type="email"
          required
          maxLength={191}
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </Field>
      <Field label={t('name')} htmlFor={`${id}-name`}>
        <Input
          id={`${id}-name`}
          maxLength={191}
          placeholder={t('namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('note')} htmlFor={`${id}-note`}>
        <Textarea
          id={`${id}-note`}
          rows={3}
          maxLength={500}
          placeholder={t('notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {targetable && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={toChannel}
            onChange={(e) => setToChannel(e.target.checked)}
          />
          {t('addToChannel', { name: channel!.name })}
        </label>
      )}
      {result && (
        <p role="status" className={`text-sm ${tone[result.tone]}`}>
          {result.text}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy || !email}>
          {busy && <Spinner />}
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

/** "Invite a teammate": an email, an optional name and note, and optionally the private channel to add them to. */
export function InviteDialog({
  open,
  onClose,
  channel,
}: {
  open: boolean;
  onClose: () => void;
  /** The open channel, offered as a target when it is private. */
  channel: TchatChannelResponse | null;
}) {
  const t = useTranslations('team-chat.invite');
  return (
    <Modal open={open} onClose={onClose} title={t('title')} closeLabel={t('close')}>
      {open && <InviteForm onClose={onClose} channel={channel} />}
    </Modal>
  );
}

/** "Pending invitations": the newest 50 requests; deciders see everyone's and can approve or decline (TW-TCHAT-025..027). */
export function InvitationsDialog({
  open,
  onClose,
  onDecided,
}: {
  open: boolean;
  onClose: () => void;
  onDecided: () => void;
}) {
  const t = useTranslations('team-chat.invitations');
  const locale = useLocale();
  const now = useNow();
  const errorText = useErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useInvitations();
  const [busyId, setBusyId] = useState<string | null>(null);
  const data = q.data;

  async function decide(inv: TchatInvitationResponse, decision: 'approve' | 'decline') {
    setBusyId(inv.id);
    try {
      await chatApi.decide(inv.id, decision);
      await refreshInvitations(qc);
      onDecided();
    } catch (err) {
      toast(errorText(err), 'danger');
      await refreshInvitations(qc);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('title')} size="md" closeLabel={t('close')}>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {q.isPending && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        )}
        {q.isError && (
          <p role="alert" className="text-sm text-danger">
            {t('loadFailed')}
          </p>
        )}
        {data && data.data.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        )}
        {data?.data.map((inv) => (
          <article key={inv.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{inv.inviteeName || inv.inviteeEmail}</div>
                {inv.inviteeName && (
                  <div className="truncate text-xs text-muted-foreground">{inv.inviteeEmail}</div>
                )}
              </div>
              <Badge
                tone={
                  inv.status === 'pending'
                    ? 'warning'
                    : inv.status === 'approved'
                      ? 'success'
                      : 'neutral'
                }
              >
                {t(`status.${inv.status}`)}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('requestedBy', {
                name: inv.requesterName,
                time: formatStamp(inv.createdAt, now, locale),
              })}
              {inv.channel && ` · #${inv.channel.name}`}
            </div>
            {inv.note && <p className="mt-1 text-xs italic">“{inv.note}”</p>}
            {inv.decidedAt && inv.status !== 'pending' && (
              <div className="mt-1 text-xs text-muted-foreground">
                {t('decidedBy', {
                  status: t(`status.${inv.status}`),
                  name: inv.decidedByName ?? '',
                  time: formatStamp(inv.decidedAt, now, locale),
                })}
              </div>
            )}
            {inv.status === 'approved' && inv.needsAccount && (
              <p className="mt-1 text-xs text-warning">{t('needsAccount')}</p>
            )}
            {data.isAdmin && inv.status === 'pending' && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busyId === inv.id}
                  onClick={() => void decide(inv, 'approve')}
                >
                  {t('approve')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === inv.id}
                  onClick={() => void decide(inv, 'decline')}
                >
                  {t('decline')}
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </Modal>
  );
}

/** Who is in a private channel, with add and remove (TW-TCHAT-005, an enhancement over Reference, which had no way). */
export function ChannelMembersDialog({
  open,
  onClose,
  channel,
  roster,
  meId,
  canManage,
  onLeft,
}: {
  open: boolean;
  onClose: () => void;
  channel: TchatChannelResponse;
  roster: TchatMember[];
  meId: string;
  /** Holds tchat.channel.manage; the channel's own admin can manage too, which the server decides. */
  canManage: boolean;
  onLeft: () => void;
}) {
  const t = useTranslations('team-chat.channelMembers');
  const errorText = useErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useChannelMembers(channel.id, open && channel.type === 'private');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const members = q.data?.data ?? [];
  const inChannel = new Set(members.map((m) => m.id));
  const candidates = roster.filter((p) => !inChannel.has(p.id));
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.members(channel.id) });

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      await chatApi.addChannelMember(channel.id, pick);
      setPick('');
      await refresh();
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    try {
      await chatApi.removeChannelMember(channel.id, userId);
      if (userId === meId) {
        onLeft();
        onClose();
      } else await refresh();
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title', { name: channel.name })}
      closeLabel={t('close')}
    >
      <div className="space-y-3">
        {q.isPending && <Spinner />}
        <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
              <Avatar id={m.id} name={m.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
              </span>
              {m.role === 'admin' && <Badge>{t('admin')}</Badge>}
              {(canManage || m.id === meId) && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(m.id)}>
                  {m.id === meId ? t('leave') : t('remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('addLabel')}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="flex-1"
            >
              <option value="">{t('choose')}</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button disabled={!pick || busy} onClick={() => void add()}>
              {t('add')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
