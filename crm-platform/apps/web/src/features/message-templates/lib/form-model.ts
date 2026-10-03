import {
  createTemplateInputSchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type TemplateDetail,
  type TplMetaCategory,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { buttonToRow, rowToButton, type ButtonRow } from './buttons';
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

export const NAME_MAX = 60;
export const HEADER_MAX = 60;
export const FOOTER_MAX = 60;
export const BODY_MAX = 1024;
export const EXPIRY_MIN = 1;
export const EXPIRY_MAX = 90;

export interface FormState {
  connectionId: string;
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
  body: string;
  bodySlots: SlotInputs;
  footer: string;
  buttons: ButtonRow[];
  /** Authentication only: minutes the code is valid, as typed. */
  otpExpiry: string;
}

export function initialState(connectionId = ''): FormState {
  return {
    connectionId,
    name: '',
    language: DEFAULT_LANGUAGE,
    metaCategory: 'UTILITY',
    headerKind: 'none',
    headerText: '',
    headerSlots: {},
    headerHandle: '',
    headerFileName: '',
    headerSampleUrl: '',
    body: '',
    bodySlots: {},
    footer: '',
    buttons: [],
    otpExpiry: '',
  };
}

/** Live while typing: lowercase, spaces become `_`, anything outside a-z 0-9 _ is dropped (WaDesk's rule, max 60). */
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
  };
}

type Fields = Omit<CreateTemplateInput, 'connectionId' | 'submit'>;

/** True when the header is a media header that has its sample (just uploaded, or kept from the saved template). */
export const hasHeaderFile = (s: FormState): boolean =>
  isMediaKind(s.headerKind) && Boolean(s.headerHandle || s.headerSampleUrl);

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
    name: d.name,
    language: d.language,
    metaCategory: meta,
    headerKind: kind,
    headerText,
    headerSlots: slotsFromMap(headerText, d.variableMap.header),
    headerHandle: '',
    headerFileName: '',
    headerSampleUrl: d.headerSampleUrl ?? '',
    body: d.body,
    bodySlots: slotsFromMap(d.body, d.variableMap.body),
    footer: d.footer ?? '',
    buttons: meta === 'AUTHENTICATION' ? [] : d.buttons.map((b) => buttonToRow(b)),
    otpExpiry: d.codeExpirationMinutes !== null ? String(d.codeExpirationMinutes) : '',
  };
}

export interface PreviewModel {
  auth: boolean;
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
    language: s.language,
    headerKind: s.headerKind,
    headerText: s.headerKind === 'text' ? fillSamples(s.headerText, s.headerSlots) : '',
    headerImageUrl: s.headerKind === 'image' && s.headerSampleUrl ? s.headerSampleUrl : null,
    body: fillSamples(s.body, s.bodySlots),
    footer: s.footer,
    buttons: s.buttons.map((b) => ({
      kind: b.kind,
      text: b.kind === 'copy_code' ? b.text || b.example : b.text,
    })),
    expiry: expiryMinutes(s),
  };
}
