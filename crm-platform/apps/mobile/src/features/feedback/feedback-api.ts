import { customerTicketItemSchema, type CreateSupportTicketRequest } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Sends feedback to the platform team as a support ticket (`support.ticket.create`): the same ticket the web's support page files,
 * so the team answers it from their helpdesk and the reply goes to the email given. The key makes a repeat of the same press one
 * ticket.
 */
export const sendFeedback = (body: CreateSupportTicketRequest, idempotencyKey: string) =>
  apiFetch('/v2/support/tickets', {
    method: 'POST',
    body,
    schema: customerTicketItemSchema,
    idempotencyKey,
  });
