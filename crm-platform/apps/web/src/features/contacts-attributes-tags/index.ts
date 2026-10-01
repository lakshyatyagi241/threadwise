/**
 * Public surface of the contacts domain. Other domains import from here, never from the folders below.
 * `SlashTextarea` is the "type / to insert an attribute" field for composers (templates, broadcasts, flows).
 */
export { SlashTextarea } from './components/slash-picker';
export { usePickerFeed } from './api/attributes';
export type { PickerEntry } from './lib/attribute-model';
export { displayName as contactDisplayName, composeName } from './lib/contact-model';
