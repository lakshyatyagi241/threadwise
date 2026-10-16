/**
 * One vocabulary for a template's buttons and header, whatever spelling the row carries.
 *
 * A template button or header reaches the code in three spellings: Meta's (`URL`, `PHONE_NUMBER`, `QUICK_REPLY`, `COPY_CODE`, `FLOW`,
 * `OTP`, header format `IMAGE`), what our own template form stores (Meta's buttons, a lower-case `attachment_type` such as `image`) and
 * Reference's (`visit_website`, `call_phone`, `copy_text`, a button address in `value`), plus the send-time kinds of the broadcast
 * overrides (`url`, `quick_reply`, `copy_code`). Every consumer used to decide for itself with its own case rule and alias list, so a
 * button one of them understood another one took for a quick reply (a link sent as a Messenger postback, a link button of an imported
 * template that never got its parameter). This is the one place that decides; the web has the same table in
 * `features/broadcasts/lib/overrides-model.ts` and the two are held together by `template-vocab.spec.ts`.
 */

import { templateButtonKindOf, type TemplateButtonKind } from '@crm/contracts';

export type ButtonKind = TemplateButtonKind;

/**
 * The kind of a stored button type, in any spelling and any case (the table lives in `@crm/contracts`, shared with the web). A type
 * nobody knows is `other`: the send path treats it as a quick reply, the places that draw or filter it leave it alone.
 */
export const buttonKindOf = templateButtonKindOf;

type Dict = Record<string, unknown>;
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

/** A button's kind from the object, reading `type`, else Meta's `sub_type`. */
export function kindOfButton(b: unknown): ButtonKind {
  if (!isDict(b)) return 'other';
  return buttonKindOf(str(b.type) || str(b.sub_type));
}

/** The link of a url button: our form and Meta store it in `url`, Reference in `value`. */
export function buttonAddress(b: unknown): string {
  return isDict(b) ? str(b.url) || str(b.value) : '';
}

/** The first sample value of a button (Meta keeps `example` as a list, our form as a string). */
export function buttonExample(b: unknown): string {
  if (!isDict(b)) return '';
  return Array.isArray(b.example) ? str(b.example[0]) : str(b.example);
}

/** The phone number of a phone button (`phone_number` is Meta's and ours, `phone` and `value` Reference's). */
export function buttonPhone(b: unknown): string {
  return isDict(b) ? str(b.phone_number) || str(b.phone) || str(b.value) : '';
}

/**
 * What a button takes at send time: `url` (the dynamic part of its link), `copy_code` (the code) or `quick_reply` (its payload), or
 * null when it takes no parameter and sending one is rejected (#132000): a phone, voice call, catalog, flow, OTP, product-list button.
 * A type nobody knows is a quick reply, as in Reference.
 */
export function sendKindOf(kind: ButtonKind): 'url' | 'copy_code' | 'quick_reply' | null {
  switch (kind) {
    case 'url':
      return 'url';
    case 'copy_code':
      return 'copy_code';
    case 'quick_reply':
    case 'other':
      return 'quick_reply';
    default:
      return null;
  }
}

export type HeaderFormat = 'text' | 'image' | 'video' | 'document' | 'location' | 'none';

/**
 * The header of a template from a stored `attachment_type` (lower case: `image`, `none`), Meta's header `format` (`IMAGE`, `TEXT`) or
 * Reference's (`TEXT`, empty): `none` and `text` both mean "no media", told apart only when the template has header text.
 */
export function headerFormatOf(raw: unknown): HeaderFormat {
  switch ((typeof raw === 'string' ? raw : '').trim().toLowerCase()) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'location':
      return 'location';
    case 'text':
      return 'text';
    default:
      return 'none';
  }
}

/** Whether the header is a file (image, video or document). */
export const isMediaHeader = (raw: unknown): boolean => {
  const f = headerFormatOf(raw);
  return f === 'image' || f === 'video' || f === 'document';
};
