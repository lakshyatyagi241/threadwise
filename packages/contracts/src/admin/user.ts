import { z } from 'zod';
import { emailSchema, uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Staff user — Settings > Users & Permissions > Users.
 *
 * Follows the contact.ts shape: Response / Create / Update / List query.
 */
export const userStatusSchema = z.enum(['active', 'inactive']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userRoleRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});

export const userResponseSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  status: userStatusSchema,
  roles: z.array(userRoleRefSchema),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().min(1).max(255),
  /** Admin sets it directly. Self-service reset/invite email is a later phase. */
  password: z.string().min(8).max(255),
  roleIds: z.array(uuidSchema).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  status: userStatusSchema.optional(),
  /** Full replacement of the user's role set, when present. */
  roleIds: z.array(uuidSchema).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).max(200).optional().describe('Free-text search over name/email'),
  status: userStatusSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
