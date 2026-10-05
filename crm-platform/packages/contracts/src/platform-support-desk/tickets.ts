import { z } from 'zod';
import { pageInfoSchema } from '../common/pagination';
import { ticketSlaSchema } from './sla-shape';

/**
 * Platform support desk (SUPP): the customer ticket form and the operator helpdesk.
 * Every id on the wire is a uuid; the ticket number (TKT-XXXXXX) is the human handle.
 */
export const SUPP_TICKET_STATUSES = [
  'open',
  'in_progress',
  'pending',
  'resolved',
  'closed',
] as const;
export const SUPP_TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const SUPP_TICKET_REASONS = [
  'bug',
  'delivery',
  'template',
  'billing',
  'integration',
  'account',
  'other',
] as const;

export const suppTicketStatusSchema = z.enum(SUPP_TICKET_STATUSES);
export const suppTicketPrioritySchema = z.enum(SUPP_TICKET_PRIORITIES);
export const suppTicketReasonSchema = z.enum(SUPP_TICKET_REASONS);
export type SuppTicketStatus = z.infer<typeof suppTicketStatusSchema>;
export type SuppTicketPriority = z.infer<typeof suppTicketPrioritySchema>;
export type SuppTicketReason = z.infer<typeof suppTicketReasonSchema>;

/** `TKT-` plus six upper-case letters or digits (the documented fallback shape is TKT-XXXX-1234). */
export const SUPP_TICKET_NUMBER_PATTERN = /^TKT-[A-Z0-9]{4,6}(-\d{4})?$/;

// --- customer ------------------------------------------------------------------------------------------------------------------

export const createSupportTicketRequestSchema = z.object({
  reason: suppTicketReasonSchema,
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().email().max(191),
  subject: z.string().trim().min(1).max(191),
  message: z.string().trim().min(1).max(20000),
});
export type CreateSupportTicketRequest = z.infer<typeof createSupportTicketRequestSchema>;

export const supportReplyRequestSchema = z.object({ body: z.string().trim().min(1).max(8000) });
export type SupportReplyRequest = z.infer<typeof supportReplyRequestSchema>;

export const customerTicketListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(10),
});
export type CustomerTicketListQuery = z.infer<typeof customerTicketListQuerySchema>;

export const customerTicketItemSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  excerpt: z.string(),
  status: suppTicketStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type CustomerTicketItem = z.infer<typeof customerTicketItemSchema>;

export const customerTicketListResponseSchema = z.object({
  data: z.array(customerTicketItemSchema),
  /** Counts for the account tab and the "more" chip: open means neither resolved nor closed. */
  summary: z.object({
    total: z.number().int(),
    open: z.number().int(),
    resolved: z.number().int(),
  }),
});
export type CustomerTicketListResponse = z.infer<typeof customerTicketListResponseSchema>;

export const customerThreadMessageSchema = z.object({
  id: z.string().uuid().nullable(),
  /** `initial` is the message typed on the form; `support` is any operator reply; `customer` a follow-up. */
  role: z.enum(['initial', 'customer', 'support']),
  body: z.string(),
  createdAt: z.string(),
});

export const customerTicketDetailSchema = customerTicketItemSchema.extend({
  reason: suppTicketReasonSchema,
  messages: z.array(customerThreadMessageSchema),
});
export type CustomerTicketDetail = z.infer<typeof customerTicketDetailSchema>;

// --- operator ------------------------------------------------------------------------------------------------------------------

export const operatorTicketListQuerySchema = z.object({
  status: suppTicketStatusSchema.optional(),
  priority: suppTicketPrioritySchema.optional(),
  agent: z.enum(['me', 'unassigned']).optional(),
  q: z.string().trim().max(191).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.string().min(1).max(512).optional(),
});
export type OperatorTicketListQuery = z.infer<typeof operatorTicketListQuerySchema>;

const assigneeSchema = z.object({ id: z.string().uuid(), name: z.string(), email: z.string() });

export const operatorTicketRowSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  status: suppTicketStatusSchema,
  priority: suppTicketPrioritySchema,
  assignee: assigneeSchema.nullable(),
  createdAt: z.string(),
});
export type OperatorTicketRow = z.infer<typeof operatorTicketRowSchema>;

export const operatorTicketListResponseSchema = z.object({
  data: z.array(operatorTicketRowSchema),
  page: pageInfoSchema,
  /** Global numbers: they ignore the active filters. */
  kpis: z.object({
    open: z.number().int(),
    unassigned: z.number().int(),
    resolved24h: z.number().int(),
    total: z.number().int(),
  }),
});
export type OperatorTicketListResponse = z.infer<typeof operatorTicketListResponseSchema>;

export const operatorThreadMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['customer', 'admin', 'system']),
  authorName: z.string(),
  body: z.string(),
  isInternalNote: z.boolean(),
  emailStatus: z.enum(['sent', 'failed']).nullable(),
  createdAt: z.string(),
});

export const operatorTicketDetailSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  /** The message typed on the form (the thread below starts after it). */
  message: z.string(),
  reason: suppTicketReasonSchema,
  customerName: z.string(),
  customerEmail: z.string(),
  status: suppTicketStatusSchema,
  priority: suppTicketPrioritySchema,
  rowVersion: z.number().int(),
  assignee: assigneeSchema.nullable(),
  workspace: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  createdAt: z.string(),
  firstResponseAt: z.string().nullable(),
  lastReplyAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  messages: z.array(operatorThreadMessageSchema),
  /** The SLA clocks of the platform default policy; both null when no policy applies. */
  sla: ticketSlaSchema,
});
export type OperatorTicketDetail = z.infer<typeof operatorTicketDetailSchema>;

export const operatorReplyRequestSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  isInternalNote: z.boolean().default(false),
});
export type OperatorReplyRequest = z.infer<typeof operatorReplyRequestSchema>;

const rowVersionSchema = z.number().int().min(1);

export const setTicketStatusRequestSchema = z.object({
  status: suppTicketStatusSchema,
  rowVersion: rowVersionSchema,
});
export const setTicketPriorityRequestSchema = z.object({
  priority: suppTicketPrioritySchema,
  rowVersion: rowVersionSchema,
});
/** `agentId` is a platform operator's uuid, or null to unassign. */
export const assignTicketRequestSchema = z.object({
  agentId: z.string().uuid().nullable(),
  rowVersion: rowVersionSchema,
});
export type SetTicketStatusRequest = z.infer<typeof setTicketStatusRequestSchema>;
export type SetTicketPriorityRequest = z.infer<typeof setTicketPriorityRequestSchema>;
export type AssignTicketRequest = z.infer<typeof assignTicketRequestSchema>;

export const ticketAssigneesResponseSchema = z.object({ data: z.array(assigneeSchema) });
export type TicketAssigneesResponse = z.infer<typeof ticketAssigneesResponseSchema>;
