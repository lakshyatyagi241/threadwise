import type { BulkConversationAction } from '@crm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { runBulkAction } from './bulk-api';
import { listKey } from './use-inbox';

/** Runs one action on the chosen conversations; the list (rows, counts) and any open thread read again afterwards. */
export function useBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: readonly string[]; action: BulkConversationAction }) =>
      runBulkAction(input.ids, input.action, Crypto.randomUUID()),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: ['inbox', 'conversation'] }),
      ]),
  });
}
