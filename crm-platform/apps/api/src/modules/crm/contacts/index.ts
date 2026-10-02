/**
 * Public surface of the contacts module.
 *
 * Other domain modules may import from HERE and nowhere else inside
 * crm/contacts — enforced by the no-cross-module-internals rule in
 * .dependency-cruiser.cjs.
 */
export { ContactsService } from './contacts.service';
export { ContactsRepository } from './contacts.repository';
export { toContactResponse } from './contacts.mapper';
export { assertContactScope } from './contact-scope';
export type { ContactRow } from './contacts.repository';
export { ContactQuotaService } from './contact-quota.service';
export type { ContactQuota } from './contact-quota.service';
export {
  contactConditions,
  contactScopeCondition,
  type ResolvedContactFilter,
} from './contact-conditions';
