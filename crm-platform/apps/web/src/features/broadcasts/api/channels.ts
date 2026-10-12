import { useQuery } from '@tanstack/react-query';
import {
  botListResponseSchema,
  igAccountListSchema,
  smsSenderListResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * Which other channels this workspace can broadcast on (TW-BCAST-003): a Telegram bot that is switched on, an Instagram account that
 * is linked, an SMS sender that is switched on. A person without the right to read a channel simply does not see its card.
 * `sms` is the key of the first active SMS sender (`sms:<id>`), which the create screen opens on (`?sender=`), or null.
 */
export function useBroadcastChannels(): {
  telegram: boolean;
  instagram: boolean;
  sms: string | null;
} {
  const canBots = useCan('tg.bots.read');
  const canAccounts = useCan('ig.accounts.read');
  const canSms = useCan('sms.senders.read');
  const bots = useQuery({
    queryKey: ['broadcasts', 'chooser', 'telegram'],
    enabled: canBots,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => apiFetch('/telegram/bots', { schema: botListResponseSchema, signal }),
  });
  const accounts = useQuery({
    queryKey: ['broadcasts', 'chooser', 'instagram'],
    enabled: canAccounts,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/instagram/accounts', { schema: igAccountListSchema, signal }),
  });
  const sms = useQuery({
    queryKey: ['broadcasts', 'chooser', 'sms'],
    enabled: canSms,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/sms/senders', { schema: smsSenderListResponseSchema, signal }),
  });
  return {
    sms: (sms.data?.data ?? []).find((s) => s.active)?.senderKey ?? null,
    telegram: (bots.data?.data ?? []).some((b) => b.active),
    instagram: (accounts.data?.data ?? []).length > 0,
  };
}
