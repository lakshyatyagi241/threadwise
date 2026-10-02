import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** Teams inside a workspace (WD-WSP-022): groups of members the inbox routes conversations to. */
export const WSP_TEAM_NAME_MAX = 64;
export const WSP_TEAM_DESCRIPTION_MAX = 255;
export const WSP_TEAM_DEFAULT_COLOR = '#075E54';
export const WSP_TEAM_DEFAULT_CAPACITY = 20;

export const WSP_ASSIGNMENT_STRATEGIES = ['manual', 'round_robin', 'least_loaded', 'sticky'] as const;
export const wspAssignmentStrategySchema = z.enum(WSP_ASSIGNMENT_STRATEGIES);
export type WspAssignmentStrategy = z.infer<typeof wspAssignmentStrategySchema>;

export const wspTeamColorSchema = z
  .string()
  .max(16)
  .regex(/^#?[0-9A-Za-z_-]{1,16}$/, 'colour is a hex code or a short name');

export const wspTeamMemberSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  presence: z.enum(['online', 'away', 'busy', 'offline']),
  isLead: z.boolean(),
  capacity: z.number().int(),
});
export type WspTeamMember = z.infer<typeof wspTeamMemberSchema>;

export const wspTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  assignmentStrategy: wspAssignmentStrategySchema,
  isDefault: z.boolean(),
  sort: z.number().int(),
  /** Device (channel line) uuids this team handles; empty = every device. */
  deviceIds: z.array(uuidSchema),
  members: z.array(wspTeamMemberSchema),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type WspTeam = z.infer<typeof wspTeamSchema>;

export const listWspTeamsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});
export type ListWspTeamsQuery = z.infer<typeof listWspTeamsQuerySchema>;

export const createWspTeamSchema = z.object({
  name: z.string().trim().min(1).max(WSP_TEAM_NAME_MAX),
  color: wspTeamColorSchema.default(WSP_TEAM_DEFAULT_COLOR),
  description: z.string().trim().max(WSP_TEAM_DESCRIPTION_MAX).nullish(),
  assignmentStrategy: wspAssignmentStrategySchema.default('manual'),
  memberIds: z.array(uuidSchema).max(500).default([]),
  deviceIds: z.array(uuidSchema).max(200).default([]),
});
export type CreateWspTeamInput = z.infer<typeof createWspTeamSchema>;

/** Every field optional; `memberIds`, when present, replaces the member list (an empty list removes everyone). */
export const updateWspTeamSchema = z.object({
  name: z.string().trim().min(1).max(WSP_TEAM_NAME_MAX).optional(),
  color: wspTeamColorSchema.optional(),
  description: z.string().trim().max(WSP_TEAM_DESCRIPTION_MAX).nullish(),
  assignmentStrategy: wspAssignmentStrategySchema.optional(),
  memberIds: z.array(uuidSchema).max(500).optional(),
  deviceIds: z.array(uuidSchema).max(200).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateWspTeamInput = z.infer<typeof updateWspTeamSchema>;
