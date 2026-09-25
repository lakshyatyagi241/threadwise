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
export { TagsService, TagsRepository, toTagResponse } from './tags';
export type { TagRow } from './tags';
export {
  ContactViewsService,
  ContactViewsRepository,
  toContactViewResponse,
} from './contact-views';
export type { ContactViewRow } from './contact-views';
export {
  ContactNotesService,
  ContactNotesRepository,
  toContactNoteResponse,
} from './contact-notes';
export type { ContactNoteRow } from './contact-notes';
export {
  ContactFilesService,
  ContactFilesRepository,
  toContactFileResponse,
} from './contact-files';
export type { ContactFileRow } from './contact-files';
export {
  ContactActivitiesService,
  ContactActivitiesRepository,
  toContactActivityResponse,
} from './contact-activities';
export type { ContactActivityRow } from './contact-activities';
export {
  ContactMeetingsService,
  ContactMeetingsRepository,
  toContactMeetingResponse,
} from './contact-meetings';
export type { ContactMeetingRow } from './contact-meetings';
