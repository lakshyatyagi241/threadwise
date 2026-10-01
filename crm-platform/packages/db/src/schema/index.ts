/**
 * Drizzle schema.
 *
 * The hand-written SQL in ../../migrations is the source of truth for the
 * database. This module mirrors it for type-safe queries — it never generates
 * DDL, and drizzle-kit push is deliberately not wired up (ADR-0004).
 *
 * If you change a table, change the SQL migration first, then mirror it here
 * in the same commit. `pnpm db:status --verify` diffs the two in CI.
 */
export * from './columns';
export * from './enums';
export * from './foundation';
export * from './contact-detail';
export * from './contact-views';
export * from './crm';
export * from './field-metadata';
export * from './partner';
export * from './ops';
export * from './auth-registration-security';
export * from './plans-subscriptions-trials';
