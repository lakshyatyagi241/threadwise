import { z } from 'zod';

/**
 * Every identifier on the wire is a uuid. The internal bigint primary key is a
 * storage/partitioning detail and must never leave the system — leaking it
 * would expose row counts and invite enumeration.
 */
export const uuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/** A staff member as a list prints them: the uuid and the name. Null wherever a row has no person (a removed user, a system write). */
export const personRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type PersonRef = z.infer<typeof personRefSchema>;

/** Human-facing identifier, e.g. CON-00001 / SNAP26-000123. */
export const displayIdSchema = z.string().regex(/^[A-Z0-9]+-[0-9]+$/);

/** E.164. Every phone identity is normalised to this before storage. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'phone must be E.164, e.g. +919876543210');

export const emailSchema = z.string().email().toLowerCase();

export const currencySchema = z.string().length(3).default('INR');
