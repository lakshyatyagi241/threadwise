'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, fetchEligibility } from '../api/calling';
import { CallError, digitsOf, isPermissionRequested } from '../lib/calls';
import { useCalling } from './calling-provider';
import { useErrorText } from './use-error-text';

/** How a direct call ended: it was placed, a permission request went out instead, calling is off, or it failed (already said by a toast). */
export type DirectCallResult = 'placed' | 'permission-sent' | 'disabled' | 'failed';

/**
 * Places a WhatsApp call to a conversation's customer with no dialog in between: the same steps as the Call button, minus its
 * "Call anyway / Ask permission" choice. When the customer has not allowed calls the server sends the permission request instead of
 * placing a call and the person is told so; every other failure is a toast. Must run under `CallingProvider` and `ToastProvider`.
 */
export function useDirectCall(): (input: {
  conversationId: string;
  displayName?: string;
  contactId?: string;
}) => Promise<DirectCallResult> {
  const t = useTranslations('calling-voice');
  const { toast } = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const canUse = useCan('call.calls.use');
  const { startOutboundCall } = useCalling();

  return async ({ conversationId, displayName, contactId }) => {
    if (!canUse) {
      toast(t('errors.FORBIDDEN'), 'danger');
      return 'failed';
    }
    try {
      const e = await qc.fetchQuery({
        queryKey: KEYS.eligibility(conversationId),
        queryFn: ({ signal }) => fetchEligibility(conversationId, signal),
        staleTime: 0,
      });
      if (!e.enabled) return 'disabled';
      const to = e.contactPhone ? digitsOf(e.contactPhone) : '';
      if (!to) {
        toast(t('toast.noPhone'), 'danger');
        return 'failed';
      }
      if (!e.numberId) {
        toast(t('toast.noNumber'), 'danger');
        return 'failed';
      }
      await startOutboundCall({ numberId: e.numberId, to, contactId, conversationId, displayName });
      return 'placed';
    } catch (err) {
      if (isPermissionRequested(err)) {
        // The server sent a permission request instead of placing the call.
        toast(t('toast.permissionSent'), 'info');
        void qc.invalidateQueries({ queryKey: KEYS.eligibility(conversationId) });
        return 'permission-sent';
      }
      if (err instanceof CallError) toast(errorText(err), 'danger');
      else toast(t('toast.startFailed', { message: errorText(err) }), 'danger');
      return 'failed';
    }
  };
}
