/**
 * Public surface of the CRM module.
 *
 * This is the ONLY path other domain modules may import from. Reaching into
 * `modules/crm/contacts/...` from outside fails the architecture check.
 */
export { CrmModule } from './crm.module';
export { ContactsService, ContactsRepository, toContactResponse } from './contacts';
export type { ContactRow } from './contacts';
