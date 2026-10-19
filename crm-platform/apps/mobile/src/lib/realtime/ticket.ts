import { realtimeTicketResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Asks the API for a one-time socket ticket with the signed-in session (`POST /v2/realtime/ticket`). The ticket works once, for a
 * minute, so every connection attempt asks again. An `ApiError` with status 401 means the session is gone.
 */
export async function mintRealtimeTicket(): Promise<string> {
  const { ticket } = await apiFetch('/v2/realtime/ticket', {
    method: 'POST',
    schema: realtimeTicketResponseSchema,
  });
  return ticket;
}
