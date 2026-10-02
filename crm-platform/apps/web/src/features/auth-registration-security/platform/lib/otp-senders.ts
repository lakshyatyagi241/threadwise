import type {
  OtpActivationReason,
  OtpSenderCreate,
  OtpSenderKind,
  OtpSenderPatch,
  OtpSenderView,
  OtpTemplateOption,
  OtpTemplateOptionsResponse,
  OtpTemplateOutcome,
  OtpTemplateState,
  RegistrationSettings,
} from '@crm/contracts';

/**
 * Pure helpers behind the sign-up code section (TW-AUTH-006/007): the sender forms, how the saved
 * template is described, and the number the operator types for a test. The API is the authority;
 * these only decide what to show and catch obvious mistakes before a request is made.
 */

export const SENDER_KINDS: readonly OtpSenderKind[] = ['waba', 'twilio', 'device', 'dev'];
export const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com/v23.0';
export const DEFAULT_TWILIO_API_BASE_URL = 'https://api.twilio.com';
export const LABEL_MAX = 60;

/** The kinds an operator can add (the log sender only exists outside production). */
export const addableKinds = (devAllowed: boolean): OtpSenderKind[] =>
  SENDER_KINDS.filter((k) => k !== 'dev' || devAllowed);

export const senderRef = (s: Pick<OtpSenderView, 'kind' | 'id'>): string => `${s.kind}:${s.id}`;

/**
 * Whether a sender can deliver a code right now. An API that predates the `connected` field sent
 * only complete senders, so a missing flag counts as connected.
 */
export const isConnected = (s: Pick<OtpSenderView, 'connected'>): boolean => s.connected !== false;

/**
 * What the sender picker offers (Reference's picker lists only connected channels): the senders that can
 * deliver a code, plus the current choice when it is saved but unfinished, so the select never shows
 * a value it cannot name. "Manage senders" still lists every sender, finished or not.
 */
export function pickerSenders(
  senders: readonly OtpSenderView[],
  selected: string,
): OtpSenderView[] {
  return senders.filter((s) => isConnected(s) || senderRef(s) === selected);
}

export interface SenderDraft {
  kind: OtpSenderKind;
  label: string;
  phoneNumberId: string;
  wabaId: string;
  graphBaseUrl: string;
  accountSid: string;
  fromNumber: string;
  apiBaseUrl: string;
  bridgeUrl: string;
  senderNumber: string;
  /** Write-only: blank on edit means "keep the saved one". */
  secret: string;
}

export type SenderField = Exclude<keyof SenderDraft, 'kind'>;

/** The fields each kind shows, in order. The label is always first. */
export const KIND_FIELDS: Record<OtpSenderKind, readonly SenderField[]> = {
  waba: ['label', 'phoneNumberId', 'wabaId', 'graphBaseUrl', 'secret'],
  twilio: ['label', 'accountSid', 'fromNumber', 'apiBaseUrl', 'secret'],
  device: ['label', 'bridgeUrl', 'senderNumber', 'secret'],
  dev: ['label'],
};

export function emptySenderDraft(kind: OtpSenderKind): SenderDraft {
  return {
    kind,
    label: '',
    phoneNumberId: '',
    wabaId: '',
    graphBaseUrl: '',
    accountSid: '',
    fromNumber: '',
    apiBaseUrl: '',
    bridgeUrl: '',
    senderNumber: '',
    secret: '',
  };
}

export function senderToDraft(s: OtpSenderView): SenderDraft {
  const d = { ...emptySenderDraft(s.kind), label: s.label };
  switch (s.kind) {
    case 'waba':
      return {
        ...d,
        phoneNumberId: s.phoneNumberId,
        wabaId: s.wabaId,
        graphBaseUrl: s.graphBaseUrl,
      };
    case 'twilio':
      return { ...d, accountSid: s.accountSid, fromNumber: s.fromNumber, apiBaseUrl: s.apiBaseUrl };
    case 'device':
      return { ...d, bridgeUrl: s.bridgeUrl, senderNumber: s.senderNumber };
    default:
      return d;
  }
}

export type SenderProblem =
  | { code: 'required' }
  | { code: 'tooLong'; max: number }
  | { code: 'digits' }
  | { code: 'url' }
  | { code: 'accountSid' }
  | { code: 'phone' };
export type SenderProblems = Partial<Record<SenderField, SenderProblem>>;

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
};
const phoneDigits = (value: string): string => value.replace(/\D/g, '');
const validPhone = (value: string): boolean => {
  const d = phoneDigits(value);
  return d.length >= 7 && d.length <= 15 && !d.startsWith('0');
};

function checkField(field: SenderField, raw: string, required: boolean): SenderProblem | null {
  const v = raw.trim();
  if (!v) return required ? { code: 'required' } : null;
  switch (field) {
    case 'label':
      return v.length > LABEL_MAX ? { code: 'tooLong', max: LABEL_MAX } : null;
    case 'phoneNumberId':
    case 'wabaId':
      return /^\d{5,24}$/.test(v) ? null : { code: 'digits' };
    case 'graphBaseUrl':
    case 'apiBaseUrl':
    case 'bridgeUrl':
      return v.length > 512 || !isHttpUrl(v) ? { code: 'url' } : null;
    case 'accountSid':
      return /^AC[0-9a-zA-Z]{32}$/.test(v) ? null : { code: 'accountSid' };
    case 'fromNumber':
    case 'senderNumber':
      return validPhone(v) ? null : { code: 'phone' };
    default:
      return null;
  }
}

/** Fields that may be left empty (a default applies). */
const OPTIONAL: ReadonlySet<SenderField> = new Set(['graphBaseUrl', 'apiBaseUrl']);

/** A new sender: every field of its kind is checked and the secret is required. */
export function buildSenderCreate(draft: SenderDraft): {
  body: OtpSenderCreate | null;
  problems: SenderProblems;
} {
  const problems: SenderProblems = {};
  for (const field of KIND_FIELDS[draft.kind]) {
    const raw = field === 'secret' ? draft.secret.trim() : draft[field];
    const problem = checkField(field, raw, !OPTIONAL.has(field));
    if (problem) problems[field] = problem;
  }
  if (Object.keys(problems).length > 0) return { body: null, problems };

  const t = (k: SenderField) => draft[k].trim();
  const optional = <K extends string>(key: K, value: string) =>
    (value ? { [key]: value } : {}) as Partial<Record<K, string>>;
  switch (draft.kind) {
    case 'waba':
      return {
        problems,
        body: {
          kind: 'waba',
          label: t('label'),
          phoneNumberId: t('phoneNumberId'),
          wabaId: t('wabaId'),
          ...optional('graphBaseUrl', t('graphBaseUrl')),
          secret: draft.secret.trim(),
        },
      };
    case 'twilio':
      return {
        problems,
        body: {
          kind: 'twilio',
          label: t('label'),
          accountSid: t('accountSid'),
          fromNumber: t('fromNumber'),
          ...optional('apiBaseUrl', t('apiBaseUrl')),
          secret: draft.secret.trim(),
        },
      };
    case 'device':
      return {
        problems,
        body: {
          kind: 'device',
          label: t('label'),
          bridgeUrl: t('bridgeUrl'),
          senderNumber: t('senderNumber'),
          secret: draft.secret.trim(),
        },
      };
    default:
      return { problems, body: { kind: 'dev', label: t('label') } };
  }
}

/**
 * An edit: only changed fields are sent. A blank secret keeps the saved one (nothing is sent); a typed
 * one replaces it. Clearing a field that has a default restores that default.
 */
export function buildSenderPatch(
  base: OtpSenderView,
  draft: SenderDraft,
): { patch: OtpSenderPatch; problems: SenderProblems } {
  const problems: SenderProblems = {};
  const patch: Record<string, string> = {};
  const was = senderToDraft(base);
  for (const field of KIND_FIELDS[base.kind]) {
    if (field === 'secret') {
      if (draft.secret.trim()) patch.secret = draft.secret.trim();
      continue;
    }
    const value = draft[field].trim();
    if (value === was[field].trim()) continue;
    const effective =
      !value && field === 'graphBaseUrl'
        ? DEFAULT_GRAPH_BASE_URL
        : !value && field === 'apiBaseUrl'
          ? DEFAULT_TWILIO_API_BASE_URL
          : value;
    const problem = checkField(field, effective, true);
    if (problem) problems[field] = problem;
    else if (effective !== was[field].trim()) patch[field] = effective;
  }
  return { patch: patch as OtpSenderPatch, problems };
}

/** One line telling senders of the same kind apart: where the number or server lives. */
export function senderSummary(s: OtpSenderView): string {
  switch (s.kind) {
    case 'waba':
      return s.phoneNumberId;
    case 'twilio':
      return s.fromNumber;
    case 'device':
      return `${s.senderNumber} @ ${hostOf(s.bridgeUrl)}`;
    default:
      return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Maps an API error path (`bridgeUrl`) to the control it belongs to. */
export function senderFieldForPath(path: string): SenderField | null {
  return (Object.values(KIND_FIELDS).flat() as SenderField[]).includes(path as SenderField)
    ? (path as SenderField)
    : null;
}

// --- the template ---------------------------------------------------------------------------------

export type TemplateState = 'none' | 'pending' | 'approved' | 'rejected' | 'local';

/** The saved template, but only if it belongs to the sender the form has selected. */
export function templateFor(
  settings: Pick<RegistrationSettings, 'otp'>,
  senderValue: string,
): OtpTemplateState | null {
  const t = settings.otp.template;
  return t && senderValue && t.sender === senderValue ? t : null;
}

export const templateState = (t: OtpTemplateState | null): TemplateState => t?.status ?? 'none';

/** Only a template Meta knows about can be re-read. */
export const canRefreshTemplate = (t: OtpTemplateState | null): boolean =>
  t?.kind === 'waba' && Boolean(t.metaTemplateId);

/** The template was made for another expiry than the form now asks for. */
export const templateIsStale = (t: OtpTemplateState | null, ttlMinutes: number | null): boolean =>
  t !== null && ttlMinutes !== null && t.codeExpirationMinutes !== ttlMinutes;

// --- the template picker ------------------------------------------------------------------------------

/**
 * The rows of the "WABA auth template" picker for the sender the form has selected. The API lists the
 * templates of the SAVED sender, so a form that has moved on to another sender shows no rows until it
 * is saved. `selectedId` is the saved template (the only one sign-up sends), or '' when none exists.
 */
export function templatePicker(
  options: OtpTemplateOptionsResponse | undefined,
  senderValue: string,
): { rows: OtpTemplateOption[]; selectedId: string } {
  if (!options || !senderValue || options.sender !== senderValue)
    return { rows: [], selectedId: '' };
  const selected = options.templates.find((t) => t.selected);
  return { rows: options.templates, selectedId: selected?.id ?? '' };
}

/**
 * Which sentence tells the operator what a "Create & submit" did. Meta can approve an authentication
 * template the moment it is submitted, or reject it, so the template's own status decides the wording
 * for a submission; the outcome alone only says "sent".
 */
export type OutcomeKey = OtpTemplateOutcome | 'approvedNow' | 'rejectedNow';

export function outcomeKey(
  outcome: OtpTemplateOutcome,
  status: OtpTemplateState['status'] | undefined,
): OutcomeKey {
  if (outcome === 'submitted' || outcome === 'resubmitted') {
    if (status === 'approved') return 'approvedNow';
    if (status === 'rejected') return 'rejectedNow';
  }
  return outcome;
}

/** The look of the message after a template action: waiting for Meta is information, a refusal is a problem. */
export function outcomeTone(key: OutcomeKey): 'success' | 'info' | 'danger' {
  switch (key) {
    case 'rejectedNow':
      return 'danger';
    case 'submitted':
    case 'resubmitted':
    case 'already_pending':
    case 'refreshed':
      return 'info';
    default:
      return 'success';
  }
}

/** The activation reasons that mean "nothing is wrong, the operator just has not finished". */
export const REASON_TONE: Record<OtpActivationReason, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  disabled: 'neutral',
  no_sender: 'warning',
  sender_missing: 'warning',
  sender_incomplete: 'warning',
  dev_in_production: 'warning',
  template_missing: 'warning',
  template_pending: 'warning',
  template_rejected: 'warning',
};

// --- test send ---------------------------------------------------------------------------------------

/**
 * "+91 98765 43221", "0091-98765-43221" or "919876543221" -> "+919876543221"; anything that
 * cannot be an international number -> null. The number must carry its country code.
 */
export function normalizePhoneInput(input: string): string | null {
  let v = input.trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (!v.startsWith('+')) v = `+${v}`;
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}
