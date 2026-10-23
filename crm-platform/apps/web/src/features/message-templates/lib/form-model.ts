import {
  createTemplateInputSchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type TemplateDetail,
  type TplMetaCategory,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { buttonToRow, rowToButton, type ButtonRow } from './buttons';
import { nextKey } from './buttons';
import { DEFAULT_LANGUAGE } from './languages';
import {
  fillSamples,
  normalizePlaceholders,
  slotsFromMap,
  syncSlots,
  toVariableMap,
  type SlotInputs,
} from './variables';

export type TplAttachment = 'image' | 'video' | 'document';
export type HeaderKind = 'none' | 'text' | TplAttachment | 'location';
export const HEADER_KINDS: readonly HeaderKind[] = [
  'none',
  'text',
  'image',
  'video',
  'document',
  'location',
];
export const isMediaKind = (k: HeaderKind): k is TplAttachment =>
  k === 'image' || k === 'video' || k === 'document';

/** A carousel's cards (Meta: 2 to 10, a short text of up to 160 characters, up to two buttons). */
export const CARDS_MIN = 2;
export const CARDS_MAX = 10;
export const CARD_BODY_MAX = 160;
export const CARD_BUTTONS_MAX = 2;
export type CardFormat = 'image' | 'video';
export type TemplateKind = 'standard' | 'carousel';

export interface CardRow {
  /** Client-only identity for React keys. Never sent. */
  key: string;
  format: CardFormat;
  /** Returned by the media upload (Meta's handle for the sample). */
  handle: string;
  fileName: string;
  /** Object-storage key of the file uploaded now. */
  mediaKey: string;
  /** The key of the file already stored on a saved template (kept when no new file is chosen). */
  image: string;
  /** A link to draw the file with (not sent as a file). */
  previewUrl: string;
  body: string;
  buttons: ButtonRow[];
}

export function newCard(format: CardFormat = 'image'): CardRow {
  return {
    key: `c${nextKey()}`,
    format,
    handle: '',
    fileName: '',
    mediaKey: '',
    image: '',
    previewUrl: '',
    body: '',
    buttons: [],
  };
}

export const hasCardFile = (c: CardRow): boolean =>
  Boolean(c.handle || c.mediaKey || c.image || c.previewUrl);

export const NAME_MAX = 60;
export const LOCATION_NAME_MAX = 100;
export const LOCATION_ADDRESS_MAX = 200;
export const HEADER_MAX = 60;
export const FOOTER_MAX = 60;
export const BODY_MAX = 1024;
export const EXPIRY_MIN = 1;
export const EXPIRY_MAX = 90;

export interface FormState {
  connectionId: string;
  /** `carousel`: a bubble of text and a row of cards; the header, footer and buttons of a standard template do not apply. */
  kind: TemplateKind;
  cards: CardRow[];
  name: string;
  language: string;
  metaCategory: TplMetaCategory;
  headerKind: HeaderKind;
  headerText: string;
  headerSlots: SlotInputs;
  /** Returned by the media upload; sent so Meta can show the sample. */
  headerHandle: string;
  headerFileName: string;
  /** The sample already stored on an existing template (kept when no new file is chosen). */
  headerSampleUrl: string;
  /** Object-storage key of the uploaded header file (sent back on save; the server keeps the stored one when this is empty). */
  headerMediaKey: string;
  /** A link to the stored header file, for the phone preview and the picker (not sent). */
  headerPreviewUrl: string;
  body: string;
  bodySlots: SlotInputs;
  footer: string;
  buttons: ButtonRow[];
  /** Authentication only: minutes the code is valid, as typed. */
  otpExpiry: string;
  /** The pin of a location header, as typed. */
  latitude: string;
  longitude: string;
  locationName: string;
  locationAddress: string;
}

export function initialState(connectionId = ''): FormState {
  return {
    connectionId,
    kind: 'standard',
    cards: [],
    name: '',
    language: DEFAULT_LANGUAGE,
    metaCategory: 'UTILITY',
    headerKind: 'none',
    headerText: '',
    headerSlots: {},
    headerHandle: '',
    headerFileName: '',
    headerSampleUrl: '',
    headerMediaKey: '',
    headerPreviewUrl: '',
    body: '',
    bodySlots: {},
    footer: '',
    buttons: [],
    otpExpiry: '',
    latitude: '',
    longitude: '',
    locationName: '',
    locationAddress: '',
  };
}

/** Live while typing: lowercase, spaces become `_`, anything outside a-z 0-9 _ is dropped (Reference's rule, max 60). */
export function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, NAME_MAX);
}

/** On blur: repeated underscores collapse and the edges are trimmed. */
export const tidyName = (raw: string): string =>
  sanitizeName(raw)
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

export const isAuth = (s: Pick<FormState, 'metaCategory'>): boolean =>
  s.metaCategory === 'AUTHENTICATION';

export const isCarousel = (s: Pick<FormState, 'kind' | 'metaCategory'>): boolean =>
  s.kind === 'carousel' && s.metaCategory !== 'AUTHENTICATION';

/** Switching to a carousel starts with two empty cards; back to standard drops them. */
export function withKind(s: FormState, kind: TemplateKind): FormState {
  if (kind === s.kind) return s;
  if (kind === 'carousel')
    return { ...s, kind, cards: s.cards.length > 0 ? s.cards : [newCard(), newCard()] };
  return { ...s, kind, cards: [] };
}

/** All the cards use one kind of file: choosing the other kind drops the files already chosen. */
export function withCardFormat(s: FormState, format: CardFormat): FormState {
  return {
    ...s,
    cards: s.cards.map((c) =>
      c.format === format
        ? c
        : { ...c, format, handle: '', fileName: '', mediaKey: '', image: '', previewUrl: '' },
    ),
  };
}

/** The cards as the API stores them. A card without a new file keeps the file saved with the template. */
export function cardsToFields(s: FormState): NonNullable<CreateTemplateInput['cards']> {
  return s.cards.map((c) => ({
    format: c.format,
    image: c.mediaKey || c.image || null,
    headerHandle: c.handle || null,
    // The link a saved card is drawn with doubles as its sample, so the checks know it has a file.
    headerSampleUrl: /^https?:\/\//i.test(c.previewUrl) ? c.previewUrl : null,
    body: c.body.trim(),
    buttons: c.buttons.map(rowToButton),
  }));
}

/** Editing the body re-derives the mapping rows; typed samples of tokens still present are kept. */
export function withBody(s: FormState, body: string): FormState {
  return { ...s, body, bodySlots: syncSlots(body, s.bodySlots) };
}
export function withHeaderText(s: FormState, headerText: string): FormState {
  return { ...s, headerText, headerSlots: syncSlots(headerText, s.headerSlots) };
}

/** Changing the header kind drops what belonged to the old one (text, uploaded sample). */
export function withHeaderKind(s: FormState, headerKind: HeaderKind): FormState {
  if (headerKind === s.headerKind) return s;
  return {
    ...s,
    headerKind,
    headerText: headerKind === 'text' ? s.headerText : '',
    headerSlots: headerKind === 'text' ? s.headerSlots : {},
    headerHandle: '',
    headerFileName: '',
    headerSampleUrl: '',
    headerMediaKey: '',
    headerPreviewUrl: '',
    latitude: '',
    longitude: '',
    locationName: '',
    locationAddress: '',
  };
}

type Fields = Omit<CreateTemplateInput, 'connectionId' | 'submit'>;

/** True when the header is a media header that has its sample (just uploaded, or kept from the saved template). */
export const hasHeaderFile = (s: FormState): boolean =>
  isMediaKind(s.headerKind) && Boolean(s.headerHandle || s.headerSampleUrl || s.headerPreviewUrl);

/** The coordinates as numbers, or null while they are empty, not numbers, or out of the range WhatsApp accepts. */
export function locationOf(
  s: Pick<FormState, 'latitude' | 'longitude' | 'locationName' | 'locationAddress'>,
): { latitude: number; longitude: number; name: string | null; address: string | null } | null {
  const lat = s.latitude.trim() === '' ? NaN : Number(s.latitude);
  const lng = s.longitude.trim() === '' ? NaN : Number(s.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    latitude: lat,
    longitude: lng,
    name: s.locationName.trim() || null,
    address: s.locationAddress.trim() || null,
  };
}

export function expiryMinutes(s: FormState): number | null {
  const n = Number(s.otpExpiry);
  return s.otpExpiry.trim() !== '' && Number.isInteger(n) ? n : null;
}

/**
 * The fields the API stores. Placeholders are renumbered per field (the author may type names) and the mapping keeps the
 * attribute and sample of every slot, so the same payload goes to the linter and to the save.
 */
export function toFields(s: FormState): Fields {
  const language = s.language.trim();
  if (isAuth(s)) {
    return {
      name: s.name.trim(),
      language,
      metaCategory: 'AUTHENTICATION',
      templateType: 'auth',
      header: null,
      attachmentType: 'none',
      headerHandle: null,
      headerSampleUrl: null,
      body: '',
      footer: null,
      buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }],
      codeExpirationMinutes: expiryMinutes(s),
      parameterFormat: 'POSITIONAL',
    };
  }
  if (isCarousel(s)) {
    return {
      name: s.name.trim(),
      language,
      metaCategory: s.metaCategory,
      templateType: 'carousel',
      header: null,
      attachmentType: 'none',
      headerHandle: null,
      headerSampleUrl: null,
      body: normalizePlaceholders(s.body),
      footer: null,
      buttons: [],
      cards: cardsToFields(s),
      variableMap: toVariableMap(null, { text: s.body, slots: s.bodySlots }),
      codeExpirationMinutes: null,
      parameterFormat: 'POSITIONAL',
    };
  }
  const textHeader = s.headerKind === 'text' && s.headerText.trim() !== '';
  const media = isMediaKind(s.headerKind);
  const attachmentType = isMediaKind(s.headerKind)
    ? s.headerKind
    : s.headerKind === 'location'
      ? 'location'
      : 'none';
  const variableMap = toVariableMap(
    textHeader ? { text: s.headerText, slots: s.headerSlots } : null,
    { text: s.body, slots: s.bodySlots },
  );
  return {
    name: s.name.trim(),
    language,
    metaCategory: s.metaCategory,
    templateType: attachmentType === 'none' ? 'standard' : 'media',
    header: textHeader ? normalizePlaceholders(s.headerText.trim()) : null,
    attachmentType,
    headerHandle: media && s.headerHandle ? s.headerHandle : null,
    headerSampleUrl: media && s.headerSampleUrl ? s.headerSampleUrl : null,
    headerMediaKey: media && s.headerMediaKey ? s.headerMediaKey : null,
    headerLocation: s.headerKind === 'location' ? locationOf(s) : null,
    body: normalizePlaceholders(s.body),
    footer: s.footer.trim() ? s.footer.trim() : null,
    buttons: s.buttons.map(rowToButton),
    variableMap,
    codeExpirationMinutes: null,
    parameterFormat: 'POSITIONAL',
  };
}

export const toCreateInput = (s: FormState, submit: boolean): CreateTemplateInput => ({
  ...toFields(s),
  connectionId: s.connectionId,
  submit,
});

export const toUpdateInput = (
  s: FormState,
  rowVersion: number,
  submit: boolean,
): UpdateTemplateInput => ({ ...toFields(s), rowVersion, submit });

export const toLintInput = (s: FormState): LintTemplateInput => ({
  ...toFields(s),
  hasHeaderFile: hasHeaderFile(s),
});

const FORM_SCHEMA = createTemplateInputSchema.omit({ connectionId: true, submit: true });

/** Field-level problems the contract itself reports (language, lengths, expiry), keyed by the first path segment. */
export function contractIssues(s: FormState): Record<string, string> {
  const r = FORM_SCHEMA.safeParse(toFields(s));
  const out: Record<string, string> = {};
  if (!r.success)
    for (const i of r.error.issues) out[String(i.path[0] ?? 'template')] ??= i.message;
  return out;
}

/** An existing template as form state, so it can be edited and sent again. */
export function stateFromDetail(d: TemplateDetail): FormState {
  const kind: HeaderKind =
    d.attachmentType !== 'none' ? d.attachmentType : d.header ? 'text' : 'none';
  const headerText = kind === 'text' ? (d.header ?? '') : '';
  const meta: TplMetaCategory = d.metaCategory ?? 'UTILITY';
  return {
    connectionId: d.connectionId ?? '',
    kind: d.templateType === 'carousel' ? 'carousel' : 'standard',
    cards: (d.cards ?? []).map((c) => ({
      key: `c${nextKey()}`,
      format: c.format,
      handle: '',
      fileName: '',
      mediaKey: '',
      image: c.image && !/^https?:\/\//i.test(c.image) ? c.image : '',
      previewUrl: c.imageUrl ?? '',
      body: c.body,
      buttons: c.buttons.map((b) => buttonToRow(b)),
    })),
    name: d.name,
    language: d.language,
    metaCategory: meta,
    headerKind: kind,
    headerText,
    headerSlots: slotsFromMap(headerText, d.variableMap.header),
    headerHandle: '',
    headerFileName: '',
    headerSampleUrl: d.headerSampleUrl ?? '',
    headerMediaKey: '',
    headerPreviewUrl: d.headerMediaUrl ?? '',
    body: d.body,
    bodySlots: slotsFromMap(d.body, d.variableMap.body),
    footer: d.footer ?? '',
    buttons: meta === 'AUTHENTICATION' ? [] : d.buttons.map((b) => buttonToRow(b)),
    otpExpiry: d.codeExpirationMinutes !== null ? String(d.codeExpirationMinutes) : '',
    latitude: d.headerLocation ? String(d.headerLocation.latitude) : '',
    longitude: d.headerLocation ? String(d.headerLocation.longitude) : '',
    locationName: d.headerLocation?.name ?? '',
    locationAddress: d.headerLocation?.address ?? '',
  };
}

export interface PreviewCard {
  format: CardFormat;
  imageUrl: string | null;
  body: string;
  buttons: Array<{ kind: ButtonRow['kind']; text: string }>;
}

export interface PreviewModel {
  auth: boolean;
  /** A carousel's cards, drawn under the bubble. */
  cards?: PreviewCard[];
  language: string;
  headerKind: HeaderKind;
  headerText: string;
  headerImageUrl: string | null;
  body: string;
  footer: string;
  buttons: Array<{ kind: ButtonRow['kind']; text: string }>;
  expiry: number | null;
}

/** What the phone shows: samples substituted for tokens (display only). */
export function previewOf(s: FormState): PreviewModel {
  return {
    auth: isAuth(s),
    cards: isCarousel(s)
      ? s.cards.map((c) => ({
          format: c.format,
          imageUrl: c.previewUrl || null,
          body: c.body,
          buttons: c.buttons.map((b) => ({ kind: b.kind, text: b.text })),
        }))
      : [],
    language: s.language,
    headerKind: s.headerKind,
    headerText: s.headerKind === 'text' ? fillSamples(s.headerText, s.headerSlots) : '',
    headerImageUrl:
      s.headerKind === 'image' ? s.headerPreviewUrl || s.headerSampleUrl || null : null,
    body: fillSamples(s.body, s.bodySlots),
    footer: s.footer,
    buttons: s.buttons.map((b) => ({
      kind: b.kind,
      text: b.kind === 'copy_code' ? b.text || b.example : b.text,
    })),
    expiry: expiryMinutes(s),
  };
}
