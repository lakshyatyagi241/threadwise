'use client';

import { useQuery } from '@tanstack/react-query';
import { nodeBridgeResponseSchema } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import type { UnofficialSwitchState } from '@/lib/unofficial-whatsapp';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

/** The state word for a Node bridge payload; no payload (loading, a failed call, an API without the field) is `unknown`. */
export const unofficialSwitchState = (
  data: { unofficialEnabled?: boolean } | undefined,
): UnofficialSwitchState =>
  data?.unofficialEnabled === true ? 'on' : data?.unofficialEnabled === false ? 'off' : 'unknown';

/**
 * The platform's unofficial WhatsApp switch, for operator screens that need to say whether a setting matters (the plan editor's
 * devices limit). It reads the Node bridge settings, shared with the Node bridge page, so the two never disagree.
 */
export function useUnofficialSwitchState(): UnofficialSwitchState {
  const q = useQuery({
    queryKey: NODE_BRIDGE_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/node-bridge', { schema: nodeBridgeResponseSchema, signal }),
    refetchOnWindowFocus: false,
    retry: false,
  });
  return unofficialSwitchState(q.data);
}
