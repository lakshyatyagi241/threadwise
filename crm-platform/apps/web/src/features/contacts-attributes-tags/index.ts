/**
 * Public surface of the contacts domain. Other domains import from here, never from the folders below.
 * `SlashTextarea` is the "type / to insert an attribute" field for composers (templates, broadcasts, flows).
 * The lookups and `ContactsReadonlyTable` serve the segments screens (the rule builder's pickers, a segment's members).
 */
export { SlashTextarea } from './components/slash-picker';
export { ContactsReadonlyTable } from './components/contacts-readonly-table';
export { RowMenu, RowMenuItem, RowMenuSeparator } from './components/row-menu';
export { usePickerFeed, useStatusOptions } from './api/attributes';
export { useGroups } from './api/groups';
export { useTags } from './api/tags';
export { useContactFields } from './api/properties';
export { contactFilterBody, type ContactFilters } from './api/contacts';
export { stageChoices, statusChoices } from './lib/option-sets';
export { frozenEdge, isScrolledSideways } from './lib/sticky';
export { isUsable as isUsableProperty } from './lib/property-model';
export type { PickerEntry } from './lib/attribute-model';
export { displayName as contactDisplayName, composeName } from './lib/contact-model';
