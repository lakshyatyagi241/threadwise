import { useQuery } from '@tanstack/react-query';
import {
  botListResponseSchema,
  facebookPageListSchema,
  igAccountListSchema,
  mailboxListResponseSchema,
  lineChannelListResponseSchema,
  smsSenderListResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';

/**
 * Which other channels this workspace can broadcast on (TW-BCAST-003): a Telegram bot that is switched on, a Facebook Page that is
 * connected, an Instagram account that is linked, an SMS sender that is switched on. A person without the right to read a channel simply does not see its card.
 * `sms` is the key of the first active SMS sender (`sms:<id>`), which the create screen opens on (`?sender=`), or null.
 * `email` is the key of the first connected mailbox the person can send from (`email:<mailbox id>`), or null: a connected, readable
 * mailbox that is shared or the person's own (another person's personal mailbox is never theirs to send from).
 */
export function useBroadcastChannels(): {
  telegram: boolean;
  facebook: boolean;
  instagram: boolean;
  line: boolean;
  sms: string | null;
  email: string | null;
} {
  const canBots = useCan('tg.bots.read');
  const canPagesRead = useCan('fb.pages.read');
  const canFbBroadcasts = useCan('fb.broadcasts.read');
  const canPages = canPagesRead && canFbBroadcasts;
  const canAccounts = useCan('ig.accounts.read');
  const canLineChannels = useCan('line.channels.read');
  const canLineBroadcasts = useCan('line.broadcasts.read');
  const canLine = canLineChannels && canLineBroadcasts;
  const canSms = useCan('sms.senders.read');
  const bots = useQuery({
    queryKey: ['broadcasts', 'chooser', 'telegram'],
    enabled: canBots,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => apiFetch('/telegram/bots', { schema: botListResponseSchema, signal }),
  });
  const pages = useQuery({
    queryKey: ['broadcasts', 'chooser', 'facebook'],
    enabled: canPages,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/facebook/pages', { schema: facebookPageListSchema, signal }),
  });
  const accounts = useQuery({
    queryKey: ['broadcasts', 'chooser', 'instagram'],
    enabled: canAccounts,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/instagram/accounts', { schema: igAccountListSchema, signal }),
  });
  const canMailboxes = useCan('mail.mailboxes.read');
  const userId = useSession().user.id;
  const mailboxes = useQuery({
    queryKey: ['broadcasts', 'chooser', 'email'],
    enabled: canMailboxes,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/email/mailboxes', { schema: mailboxListResponseSchema, signal }),
  });
  const sms = useQuery({
    queryKey: ['broadcasts', 'chooser', 'sms'],
    enabled: canSms,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/sms/senders', { schema: smsSenderListResponseSchema, signal }),
  });
  const mailbox = (mailboxes.data?.data ?? []).find(
    (m) =>
      m.status === 'connected' &&
      !m.contentHidden &&
      (m.scope === 'shared' || m.ownerUserId === userId),
  );
  const lineChannels = useQuery({
    queryKey: ['broadcasts', 'chooser', 'line'],
    enabled: canLine,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/line/channels', { schema: lineChannelListResponseSchema, signal }),
  });
  return {
    email: mailbox ? `email:${mailbox.id}` : null,
    sms: (sms.data?.data ?? []).find((s) => s.active)?.senderKey ?? null,
    telegram: (bots.data?.data ?? []).some((b) => b.active),
    facebook: (pages.data?.data ?? []).some((p) => p.status === 'connected'),
    instagram: (accounts.data?.data ?? []).length > 0,
    line: (lineChannels.data?.data ?? []).some((c) => c.active),
  };
}
