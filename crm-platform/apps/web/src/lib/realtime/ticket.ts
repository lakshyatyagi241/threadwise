import { realtimeTicketResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * Asks the API for a one-time socket ticket. The browser cannot read its httpOnly session cookie, so the request goes through the
 * same-origin proxy (`/api/v2/*`), which adds the session token; the page only ever sees the ticket, which works once for a minute.
 * An `ApiError` with status 401 means the session is gone.
 */
export async function mintRealtimeTicket(): Promise<string> {
  const { ticket } = await apiFetch('/realtime/ticket', {
    method: 'POST',
    schema: realtimeTicketResponseSchema,
  });
  return ticket;
}
