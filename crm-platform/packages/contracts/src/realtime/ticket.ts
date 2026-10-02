import { z } from 'zod';

/**
 * `POST /v2/realtime/ticket`. The browser cannot read its httpOnly session cookie, so the same-origin proxy (which can)
 * calls this with the session token and the page gets a ticket it can hand to the socket handshake
 * (`io(url, { auth: { ticket } })`). A ticket works once and for `expiresIn` seconds, so a reconnect asks for a new one.
 */
export const realtimeTicketResponseSchema = z.object({
  ticket: z.string().min(16),
  expiresIn: z.number().int().positive(),
});
export type RealtimeTicketResponse = z.infer<typeof realtimeTicketResponseSchema>;
