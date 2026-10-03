import { z } from 'zod';
import { pageInfoSchema } from '../common/pagination';
import { suppTicketPrioritySchema, suppTicketStatusSchema } from './tickets';

/**
 * Platform support desk (SUPP), operator side beyond the inbox: SLA, kanban, agents, customers, playbooks, reports and the
 * platform inbox. Every id on the wire is a uuid. Writes that change an existing row carry `rowVersion` (409 when stale).
 */

const iso = z.string();
const rowVersion = z.number().int().min(1);
const minutes = z.number().int().min(0);

// --- SLA ---------------------------------------------------------------------------------------------------------------------------

export const slaPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  firstResponseMinutes: z.number().int(),
  resolutionMinutes: z.number().int(),
  pauseWhenWaitingOnCustomer: z.boolean(),
  respectBusinessHours: z.boolean(),
  isDefault: z.boolean(),
  rowVersion,
});
export type SlaPolicy = z.infer<typeof slaPolicySchema>;

export const slaPolicyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  firstResponseMinutes: z.number().int().min(1).max(10080),
  resolutionMinutes: z.number().int().min(1).max(43200),
  pauseWhenWaitingOnCustomer: z.boolean().default(false),
  respectBusinessHours: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type SlaPolicyInput = z.infer<typeof slaPolicyInputSchema>;

export const updateSlaPolicyRequestSchema = slaPolicyInputSchema.extend({ rowVersion });
export type UpdateSlaPolicyRequest = z.infer<typeof updateSlaPolicyRequestSchema>;

export const SLA_BREACH_TYPES = ['first_response', 'resolution'] as const;
export const SLA_BREACH_SEVERITIES = ['warn', 'breach', 'hard_breach'] as const;
export const slaBreachSchema = z.object({
  id: z.string().uuid(),
  breachedAt: iso,
  ticketId: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  breachType: z.enum(SLA_BREACH_TYPES),
  overByMinutes: minutes,
  severity: z.enum(SLA_BREACH_SEVERITIES),
});

export const slaBoardResponseSchema = z.object({
  policies: z.array(slaPolicySchema),
  breaches: z.array(slaBreachSchema),
  kpis: z.object({
    policies: z.number().int(),
    /** The rows of the recent-breaches table (at most 50), as in Reference. */
    openBreaches: z.number().int(),
    /** Open tickets whose running timer is in its last quarter or already overdue. */
    atRisk: z.number().int(),
    /** Share (0..100, one decimal) of tickets resolved in the last 7 days that never breached. */
    compliance7d: z.number(),
  }),
});
export type SlaBoardResponse = z.infer<typeof slaBoardResponseSchema>;

// --- kanban ------------------------------------------------------------------------------------------------------------------------

export const BOARD_COLUMNS = ['open', 'in_progress', 'pending', 'resolved'] as const;
export const boardColumnSchema = z.enum(BOARD_COLUMNS);
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const suppBoardQuerySchema = z.object({
  mine: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const boardCardSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  excerpt: z.string(),
  customer: z.string(),
  priority: suppTicketPrioritySchema,
  status: suppTicketStatusSchema,
  createdAt: iso,
  rowVersion,
});
export type BoardCard = z.infer<typeof boardCardSchema>;

export const suppBoardResponseSchema = z.object({
  columns: z.object({
    open: z.array(boardCardSchema),
    in_progress: z.array(boardCardSchema),
    pending: z.array(boardCardSchema),
    resolved: z.array(boardCardSchema),
  }),
  mineOnly: z.boolean(),
});
export type SuppBoardResponse = z.infer<typeof suppBoardResponseSchema>;

export const moveCardRequestSchema = z.object({ status: boardColumnSchema, rowVersion });
export type MoveCardRequest = z.infer<typeof moveCardRequestSchema>;

// --- agents ------------------------------------------------------------------------------------------------------------------------

export const agentOperatorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
});

export const supportAgentSchema = z.object({
  id: z.string().uuid(),
  operator: agentOperatorSchema,
  specialty: z.string().nullable(),
  isActive: z.boolean(),
  openCount: z.number().int(),
  resolved30d: z.number().int(),
  avgFirstResponseMinutes: z.number().int(),
  rowVersion,
});
export type SupportAgent = z.infer<typeof supportAgentSchema>;

export const agentsResponseSchema = z.object({
  data: z.array(supportAgentSchema),
  /** Active super admin / support operators not on the roster yet. */
  candidates: z.array(agentOperatorSchema),
  kpis: z.object({
    total: z.number().int(),
    active: z.number().int(),
    openTotal: z.number().int(),
    unassigned: z.number().int(),
  }),
});
export type AgentsResponse = z.infer<typeof agentsResponseSchema>;

export const createAgentRequestSchema = z.object({
  operatorId: z.string().uuid(),
  specialty: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const setAgentActiveRequestSchema = z.object({ isActive: z.boolean(), rowVersion });
export type SetAgentActiveRequest = z.infer<typeof setAgentActiveRequestSchema>;

// --- customers ---------------------------------------------------------------------------------------------------------------------

export const customersQuerySchema = z.object({ q: z.string().trim().max(120).optional() });
export type CustomersQuery = z.infer<typeof customersQuerySchema>;

export const supportCustomerRowSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  openTickets: z.number().int(),
  totalTickets: z.number().int(),
  avgResolutionMinutes: z.number().int().nullable(),
  lastTicketAt: iso.nullable(),
});
export const customersResponseSchema = z.object({
  data: z.array(supportCustomerRowSchema),
  kpis: z.object({
    customers: z.number().int(),
    total: z.number().int(),
    open: z.number().int(),
    top: z.number().int(),
  }),
});
export type CustomersResponse = z.infer<typeof customersResponseSchema>;

export const customerTicketRowSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  subject: z.string(),
  openedBy: z.string(),
  status: suppTicketStatusSchema,
  priority: suppTicketPrioritySchema,
  assignee: z.string().nullable(),
  createdAt: iso,
  resolvedInMinutes: z.number().int().nullable(),
});
export const customerDetailResponseSchema = z.object({
  workspace: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  stats: z.object({
    total: z.number().int(),
    open: z.number().int(),
    resolved: z.number().int(),
    avgFirstResponseMinutes: z.number().int(),
    avgResolutionMinutes: z.number().int(),
  }),
  tickets: z.array(customerTicketRowSchema),
});
export type CustomerDetailResponse = z.infer<typeof customerDetailResponseSchema>;

// --- playbooks ---------------------------------------------------------------------------------------------------------------------

export const PLAYBOOK_ACTIONS = [
  'set_status',
  'set_priority',
  'add_tag',
  'reply',
  'assign',
  'note',
] as const;
export const PLAYBOOK_TRIGGERS = ['manual', 'status_change', 'tag_added'] as const;
export const playbookStepSchema = z.object({
  action: z.enum(PLAYBOOK_ACTIONS),
  value: z.string().trim().max(8000).default(''),
});
export type PlaybookStep = z.infer<typeof playbookStepSchema>;

export const playbookSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  triggerType: z.enum(PLAYBOOK_TRIGGERS),
  triggerValue: z.string().nullable(),
  steps: z.array(playbookStepSchema),
  isActive: z.boolean(),
  useCount: z.number().int(),
  rowVersion,
});
export type Playbook = z.infer<typeof playbookSchema>;

export const playbooksResponseSchema = z.object({
  data: z.array(playbookSchema),
  kpis: z.object({ total: z.number().int(), active: z.number().int(), uses: z.number().int() }),
});
export type PlaybooksResponse = z.infer<typeof playbooksResponseSchema>;

export const createPlaybookRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  triggerType: z.enum(PLAYBOOK_TRIGGERS).default('manual'),
  triggerValue: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  steps: z.array(playbookStepSchema).max(20).default([]),
});
export type CreatePlaybookRequest = z.infer<typeof createPlaybookRequestSchema>;

export const setPlaybookActiveRequestSchema = z.object({ isActive: z.boolean(), rowVersion });
export type SetPlaybookActiveRequest = z.infer<typeof setPlaybookActiveRequestSchema>;

/** Active manual playbooks for the panel's "Run playbook" picker. */
export const runnablePlaybooksResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })),
});
export type RunnablePlaybooksResponse = z.infer<typeof runnablePlaybooksResponseSchema>;

// --- reports -----------------------------------------------------------------------------------------------------------------------

export const reportsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .default(30)
    .transform((d) => Math.max(1, Math.min(365, d))),
});
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

export const reportsResponseSchema = z.object({
  days: z.number().int(),
  kpis: z.object({
    tickets: z.number().int(),
    resolved: z.number().int(),
    avgFirstResponseMinutes: z.number().int(),
    avgResolutionMinutes: z.number().int(),
    compliance: z.number(),
  }),
  /** One entry per calendar day (UTC) of the window, zero-filled. */
  volume: z.array(z.object({ date: z.string(), count: z.number().int() })),
  /** All-time, as in Reference. */
  byStatus: z.array(z.object({ status: suppTicketStatusSchema, count: z.number().int() })),
  topAgents: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      resolved: z.number().int(),
      avgFirstResponseMinutes: z.number().int().nullable(),
      avgResolutionMinutes: z.number().int().nullable(),
    }),
  ),
});
export type ReportsResponse = z.infer<typeof reportsResponseSchema>;

// --- platform inbox ----------------------------------------------------------------------------------------------------------------

export const SUPP_INBOX_TABS = ['sla_breach', 'unassigned', 'spam', 'all'] as const;
export const WORKSPACE_FLAGS = [
  'spam',
  'abuse',
  'fraud',
  'billing_overdue',
  'tos_violation',
  'frozen',
] as const;
export const NOTE_SEVERITIES = ['info', 'warn', 'critical'] as const;

export const inboxWorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  status: z.string(),
  openCount: z.number().int(),
  breachCount: z.number().int(),
  lastActiveAt: iso.nullable(),
  flags: z.array(
    z.object({
      id: z.string().uuid(),
      flag: z.enum(WORKSPACE_FLAGS),
      reason: z.string().nullable(),
    }),
  ),
});
export type InboxWorkspace = z.infer<typeof inboxWorkspaceSchema>;

export const inboxBootstrapSchema = z.object({
  /** The caller's platform permissions (all 16 keys), so the screen can hide what it cannot do. */
  permissions: z.record(z.boolean()),
  workspaces: z.array(inboxWorkspaceSchema),
  kpis: z.object({
    workspaces: z.number().int(),
    breachTotal: z.number().int(),
    openTotal: z.number().int(),
  }),
});
export type InboxBootstrap = z.infer<typeof inboxBootstrapSchema>;

export const inboxQueueQuerySchema = z.object({
  tab: z.enum(SUPP_INBOX_TABS).catch('sla_breach').default('sla_breach'),
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
});
export type InboxQueueQuery = z.infer<typeof inboxQueueQuerySchema>;

export const inboxQueueItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  title: z.string(),
  preview: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  channelId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  teamName: z.string().nullable(),
  teamColor: z.string().nullable(),
  lastMessageAt: iso.nullable(),
  slaBreached: z.boolean(),
  slaFirstDue: iso.nullable(),
  slaResolutionDue: iso.nullable(),
  isSpam: z.boolean(),
  flags: z.array(z.enum(WORKSPACE_FLAGS)),
});
export const inboxQueueResponseSchema = z.object({
  data: z.array(inboxQueueItemSchema),
  page: pageInfoSchema,
  total: z.number().int(),
});
export type InboxQueueResponse = z.infer<typeof inboxQueueResponseSchema>;

export const inboxConversationSchema = z.object({
  conversation: inboxQueueItemSchema.extend({ peerName: z.string().nullable(), createdAt: iso }),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      direction: z.enum(['in', 'out']),
      kind: z.string(),
      body: z.string().nullable(),
      status: z.string(),
      mediaMime: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string().uuid(),
      body: z.string(),
      authorName: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  events: z.array(z.object({ type: z.string(), actorType: z.string(), createdAt: iso })),
  platformNotes: z.array(
    z.object({
      id: z.string().uuid(),
      body: z.string(),
      severity: z.enum(NOTE_SEVERITIES),
      adminName: z.string().nullable(),
      createdAt: iso,
    }),
  ),
});
export type InboxConversation = z.infer<typeof inboxConversationSchema>;

export const platformNoteRequestSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  severity: z.enum(NOTE_SEVERITIES).default('info'),
});
export type PlatformNoteRequest = z.infer<typeof platformNoteRequestSchema>;

export const flagWorkspaceRequestSchema = z.object({
  flag: z.enum(WORKSPACE_FLAGS),
  reason: z.string().trim().max(500).optional(),
});
export type FlagWorkspaceRequest = z.infer<typeof flagWorkspaceRequestSchema>;

export const suspendWorkspaceRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type SuspendWorkspaceRequest = z.infer<typeof suspendWorkspaceRequestSchema>;

export const impersonateRequestSchema = z.object({ reason: z.string().trim().min(8).max(500) });
export type ImpersonateRequest = z.infer<typeof impersonateRequestSchema>;

export const inboxAuditQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type InboxAuditQuery = z.infer<typeof inboxAuditQuerySchema>;

export const inboxAuditResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      workspaceId: z.string().uuid().nullable(),
      workspaceName: z.string().nullable(),
      actorName: z.string().nullable(),
      at: iso,
    }),
  ),
});
export type InboxAuditResponse = z.infer<typeof inboxAuditResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
