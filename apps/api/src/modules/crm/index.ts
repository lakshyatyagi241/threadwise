/**
 * Public surface of the CRM module.
 *
 * This is the ONLY path other domain modules may import from. Reaching into
 * `modules/crm/contacts/...` (or field-sections/fields/status-options) from
 * outside fails the architecture check.
 */
export { CrmModule } from './crm.module';
export { ContactsService, ContactsRepository, toContactResponse } from './contacts';
export type { ContactRow } from './contacts';
export {
  FieldSectionsService,
  FieldSectionsRepository,
  toFieldSectionResponse,
} from './field-sections';
export type { FieldSectionRow } from './field-sections';
export {
  FieldsService,
  FieldsRepository,
  FieldOptionsRepository,
  FieldDependenciesRepository,
  toFieldResponse,
  toFieldOptionResponse,
  toFieldDependencyResponse,
  toFieldOptionDependencyResponse,
} from './fields';
export type {
  FieldRow,
  FieldOptionRow,
  FieldDependencyRow,
  FieldOptionDependencyRow,
} from './fields';
export {
  StatusOptionsService,
  StatusOptionsRepository,
  toStatusOptionResponse,
} from './status-options';
export type { StatusOptionRow } from './status-options';
