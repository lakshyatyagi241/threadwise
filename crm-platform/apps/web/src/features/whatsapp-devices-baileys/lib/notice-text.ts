import {
  PERSONAL_WA_NOTICE_ITEMS,
  PERSONAL_WA_NOTICE_NOTES,
  PERSONAL_WA_PAIRING_CODE_WARNING,
} from '@crm/contracts';

/** `2026-10-07.1` as a message key segment (a dot would split the path): `v2026_10_07_1`. */
export const noticeKeyOf = (version: string): string => `v${version.replace(/[^0-9A-Za-z]/g, '_')}`;

/** Message path of one statement or note of a notice version, under `whatsapp-devices-baileys`. */
export const itemPath = (version: string, id: string): string =>
  `notice.texts.${noticeKeyOf(version)}.items.${id}`;
export const notePath = (version: string, id: string): string =>
  `notice.texts.${noticeKeyOf(version)}.notes.${id}`;

/**
 * The canonical English text of the three statements and the notes, from `@crm/contracts` (the API hashes exactly this text into
 * every acknowledgement). A locale that has no translation for the version in force shows this English text rather than nothing.
 */
export const CANONICAL_ITEMS = PERSONAL_WA_NOTICE_ITEMS;
export const CANONICAL_NOTES = PERSONAL_WA_NOTICE_NOTES;
export const PAIRING_CODE_WARNING_EN = PERSONAL_WA_PAIRING_CODE_WARNING;
