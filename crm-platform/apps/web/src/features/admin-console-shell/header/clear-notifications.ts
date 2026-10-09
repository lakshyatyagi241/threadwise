import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearNotificationsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * The bell's "Clear all" (WD-ASHELL-018). Deletes my notifications, then both the count and the list are read again, so the
 * panel shows its empty copy and the badge disappears.
 */
export function useClearNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch('/shell/notifications', {
        method: 'DELETE',
        schema: clearNotificationsResponseSchema,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
