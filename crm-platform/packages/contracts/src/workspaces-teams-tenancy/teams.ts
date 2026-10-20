import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { wspDisplayName } from './members';

/**
 * Teams inside a workspace (TW-WSP-022, Teams v2 BL-381): groups of people used for conversations (routing and assignment),
 * for records (contact, company and deal assignment) and for reports. One team entity serves chat, CRM and workspaces that have both.
 */
export const WSP_TEAM_NAME_MAX = 64;
export const WSP_TEAM_DESCRIPTION_MAX = 255;
export const WSP_TEAM_DEFAULT_COLOR = '#075E54';
export const WSP_TEAM_DEFAULT_CAPACITY = 20;
/** Levels of the team tree, the top team being level 1. A deeper tree is refused (`WSP_TEAM_PARENT_INVALID`). */
export const WSP_TEAM_MAX_DEPTH = 5;

export const WSP_ASSIGNMENT_STRATEGIES = [
  'manual',
  'round_robin',
  'least_loaded',
  'sticky',
] as const;
export const wspAssignmentStrategySchema = z.enum(WSP_ASSIGNMENT_STRATEGIES);
export type WspAssignmentStrategy = z.infer<typeof wspAssignmentStrategySchema>;

/** A person on a team is a plain member or a lead. The team's one manager (`lead`) is always a lead member. */
export const WSP_TEAM_MEMBER_ROLES = ['member', 'lead'] as const;
export const wspTeamMemberRoleSchema = z.enum(WSP_TEAM_MEMBER_ROLES);
export type WspTeamMemberRole = z.infer<typeof wspTeamMemberRoleSchema>;

export const wspTeamColorSchema = z
  .string()
  .max(16)
  .regex(/^#?[0-9A-Za-z_-]{1,16}$/, 'colour is a hex code or a short name');

export const wspTeamMemberSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  presence: z.enum(['online', 'away', 'busy', 'offline']),
  /** `role === 'lead'`; kept for clients written before roles existed. */
  isLead: z.boolean(),
  role: wspTeamMemberRoleSchema,
  /** This is the person's main team (reporting only; routing, assignment and visibility use every team). */
  isPrimary: z.boolean(),
  capacity: z.number().int(),
});
export type WspTeamMember = z.infer<typeof wspTeamMemberSchema>;

/** Where a team is used: the numbers behind "used by" on the Teams screen and what deleting it would touch. */
export const wspTeamUsageSchema = z.object({
  routingRules: z.number().int(),
  assignmentRules: z.number().int(),
  segmentShares: z.number().int(),
  childTeams: z.number().int(),
  /** Conversations (open or not) currently assigned to the team. */
  conversations: z.number().int(),
});
export type WspTeamUsage = z.infer<typeof wspTeamUsageSchema>;

/**
 * Settings the team stores that no part of the product reads yet (business hours, time zone, default assignee: they arrive with
 * the routing update). Shown read-only on the Teams screen, never silently ignored.
 */
export const wspTeamUnusedSettingsSchema = z.object({
  businessHours: z.unknown().nullable(),
  timezone: z.string().nullable(),
  defaultAssignee: z.object({ id: uuidSchema, fullName: z.string() }).nullable(),
});
export type WspTeamUnusedSettings = z.infer<typeof wspTeamUnusedSettingsSchema>;

export const wspTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  assignmentStrategy: wspAssignmentStrategySchema,
  isDefault: z.boolean(),
  sort: z.number().int(),
  /** Device (channel line) uuids this team handles; empty = every device. Stored, not read by routing yet. */
  deviceIds: z.array(uuidSchema),
  /** The parent team, null for a top-level team. */
  parentId: uuidSchema.nullable(),
  /** 1 for a top-level team, 2 for its children, up to `WSP_TEAM_MAX_DEPTH`. */
  depth: z.number().int(),
  /** The team's manager; null when none is set or the manager is deactivated (the choice is kept for their return). */
  lead: z.object({ id: uuidSchema, fullName: z.string() }).nullable(),
  /** The team may be chosen as an inbox routing / assignment target. */
  receivesConversations: z.boolean(),
  /** The team may be chosen as a contact, company and deal assignment pool. */
  receivesRecords: z.boolean(),
  /** Counts as a scope boundary for "my team and sub-teams" (applies from the next release; stored now). */
  isScopeBoundary: z.boolean(),
  members: z.array(wspTeamMemberSchema),
  memberCount: z.number().int(),
  usage: wspTeamUsageSchema,
  unusedSettings: wspTeamUnusedSettingsSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type WspTeam = z.infer<typeof wspTeamSchema>;

export const listWspTeamsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});
export type ListWspTeamsQuery = z.infer<typeof listWspTeamsQuerySchema>;

export const createWspTeamSchema = z.object({
  name: wspDisplayName(WSP_TEAM_NAME_MAX),
  color: wspTeamColorSchema.default(WSP_TEAM_DEFAULT_COLOR),
  description: z.string().trim().max(WSP_TEAM_DESCRIPTION_MAX).nullish(),
  assignmentStrategy: wspAssignmentStrategySchema.default('manual'),
  memberIds: z.array(uuidSchema).max(500).default([]),
  deviceIds: z.array(uuidSchema).max(200).default([]),
  parentId: uuidSchema.nullish(),
  /** Becomes a member with the lead role if not on the team yet. */
  leadId: uuidSchema.nullish(),
  receivesConversations: z.boolean().default(true),
  receivesRecords: z.boolean().default(true),
});
export type CreateWspTeamInput = z.infer<typeof createWspTeamSchema>;

/**
 * Every field optional; `memberIds`, when present, replaces the member list (an empty list removes everyone). Members that stay keep
 * their role and primary mark. `parentId: null` makes the team top-level, `leadId: null` removes the manager.
 */
export const updateWspTeamSchema = z.object({
  name: wspDisplayName(WSP_TEAM_NAME_MAX).optional(),
  color: wspTeamColorSchema.optional(),
  description: z.string().trim().max(WSP_TEAM_DESCRIPTION_MAX).nullish(),
  assignmentStrategy: wspAssignmentStrategySchema.optional(),
  memberIds: z.array(uuidSchema).max(500).optional(),
  deviceIds: z.array(uuidSchema).max(200).optional(),
  parentId: uuidSchema.nullish(),
  leadId: uuidSchema.nullish(),
  receivesConversations: z.boolean().optional(),
  receivesRecords: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateWspTeamInput = z.infer<typeof updateWspTeamSchema>;

/** Adds one person to a team (or changes them when already on it). `isPrimary: true` makes this the person's main team. */
export const addWspTeamMemberSchema = z.object({
  userId: uuidSchema,
  role: wspTeamMemberRoleSchema.default('member'),
  isPrimary: z.boolean().optional(),
});
export type AddWspTeamMemberInput = z.infer<typeof addWspTeamMemberSchema>;

export const updateWspTeamMemberSchema = z
  .object({
    role: wspTeamMemberRoleSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isPrimary !== undefined, {
    message: 'Send a role, a primary mark or both',
  });
export type UpdateWspTeamMemberInput = z.infer<typeof updateWspTeamMemberSchema>;

/** The teams of one person, as the members screens show them. */
export const wspPersonTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  role: wspTeamMemberRoleSchema,
  isPrimary: z.boolean(),
});
export type WspPersonTeam = z.infer<typeof wspPersonTeamSchema>;

/** What happens to a deactivated person's owned records and open conversations (decision D10). */
export const WSP_HANDOVER_MODES = ['person', 'team_lead', 'leave'] as const;
export const wspHandoverModeSchema = z.enum(WSP_HANDOVER_MODES);
export type WspHandoverMode = z.infer<typeof wspHandoverModeSchema>;

/** What a person holds, and who could take it over, for the deactivate dialog. */
export const wspHandoverPreviewSchema = z.object({
  contacts: z.number().int().nonnegative(),
  openDeals: z.number().int().nonnegative(),
  openConversations: z.number().int().nonnegative(),
  /** The active managers of the person's teams (the primary team first), never the person themself. */
  teamLeads: z.array(z.object({ id: uuidSchema, fullName: z.string(), teamName: z.string() })),
});
export type WspHandoverPreview = z.infer<typeof wspHandoverPreviewSchema>;

export const wspHandoverSchema = z
  .object({
    mode: wspHandoverModeSchema,
    /** The person who takes over, for `mode: 'person'`. */
    userId: uuidSchema.optional(),
  })
  .refine((v) => v.mode !== 'person' || v.userId !== undefined, {
    message: 'Choose who takes over',
    path: ['userId'],
  });
export type WspHandoverInput = z.infer<typeof wspHandoverSchema>;

export const wspHandoverResultSchema = z.object({
  mode: wspHandoverModeSchema,
  movedContacts: z.number().int(),
  movedDeals: z.number().int(),
  movedConversations: z.number().int(),
  /** Still waiting because one run moves at most this many; run the handover again. */
  remaining: z.number().int(),
  toUser: z.object({ id: uuidSchema, fullName: z.string() }).nullable(),
});
export type WspHandoverResult = z.infer<typeof wspHandoverResultSchema>;
