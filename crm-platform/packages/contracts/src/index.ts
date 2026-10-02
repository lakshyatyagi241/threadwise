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
export * from './crm/contact-activity';
export * from './crm/contact-file';
export * from './crm/contact-meeting';
export * from './crm/contact-note';
export * from './crm/contact-view';
export * from './crm/field-metadata';
export * from './crm/tag';
export * from './partner/partner-agent';
export * from './public/lead-read';
export * from './admin/user';
export * from './admin/role';
export * from './auth-registration-security';
export * from './plans-subscriptions-trials';
export * from './contacts-attributes-tags';
export * from './addons-extension-registry';
