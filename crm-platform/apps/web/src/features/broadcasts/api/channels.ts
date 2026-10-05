import { useQuery } from '@tanstack/react-query';
import { botListResponseSchema, igAccountListSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * Which other channels this workspace can broadcast on (WD-BCAST-003): a Telegram bot that is switched on, an Instagram account that
 * is linked. A person without the right to read a channel simply does not see its card.
 */
export function useBroadcastChannels(): { telegram: boolean; instagram: boolean } {
  const canBots = useCan('tg.bots.read');
  const canAccounts = useCan('ig.accounts.read');
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
  return {
    telegram: (bots.data?.data ?? []).some((b) => b.active),
    instagram: (accounts.data?.data ?? []).length > 0,
  };
}
