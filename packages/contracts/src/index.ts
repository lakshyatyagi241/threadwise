/**
 * @crm/contracts — the single source of truth for every shape that crosses the
 * network boundary.
 *
 * Rules:
 *  - Zod schema first, TypeScript type inferred from it. Never the reverse.
 *  - API payloads are camelCase; the database is snake_case. The mapping lives
 *    in the API repository layer, not here.
 *  - Internal bigint ids never appear. Every identifier on the wire is a uuid.
 */
export * from './common/ids';
export * from './common/pagination';
export * from './common/errors';
export * from './common/enums';
export * from './crm/contact';
export * from './crm/field-metadata';
export * from './partner/partner-agent';
export * from './public/lead-read';
export * from './admin/user';
export * from './admin/role';
