import {
  CAMPAIGN_EMAIL_SUBJECT_MAX,
  type CampaignConfig,
  type CampaignType,
  type CreateCampaignInput,
} from '@crm/contracts';

/** What the campaign builder decides without the network (TW-CAMP-003 to 010). Pure. */

export interface ButtonRow {
  type: 'url' | 'quick_reply' | 'phone_number' | 'copy_code';
  text: string;
  value: string;
}

export interface BuilderForm {
  name: string;
  senderKey: string;
  type: CampaignType;
  customMessage: string;
  customMessageB: string;
  customHeader: string;
  customFooter: string;
  buttons: ButtonRow[];
  mediaUrl: string;
  templateId: string;
  templateIdB: string;
  templateOverrides: Record<string, unknown> | null;
  templateOverridesB: Record<string, unknown> | null;
  flowId: string;
  flowIdB: string;
  abTesting: boolean;
  abSplit: number;
  trackingEnabled: boolean;
  retryFailed: boolean;
  scheduleType: 'now' | 'scheduled' | 'recurring';
  sendDate: string;
  sendTime: string;
  timezone: string;
  repeatInterval: 'daily' | 'weekly' | 'monthly';
  repeatUntil: string;
  expiresAt: string;
  throttleMinSec: string;
  throttleMaxSec: string;
  batchSize: string;
  batchPauseMin: string;
  dailyLimit: string;
  windowStart: string;
  windowEnd: string;
  contactIds: string[];
  groupIds: string[];
  tagIds: string[];
  segmentIds: string[];
  manualNumbers: string;
  csvText: string;
}

export const EMPTY_FORM: BuilderForm = {
  name: '',
  senderKey: '',
  type: 'text',
  customMessage: '',
  customMessageB: '',
  customHeader: '',
  customFooter: '',
  buttons: [],
  mediaUrl: '',
  templateId: '',
  templateIdB: '',
  templateOverrides: null,
  templateOverridesB: null,
  flowId: '',
  flowIdB: '',
  abTesting: false,
  abSplit: 50,
  trackingEnabled: true,
  retryFailed: true,
  scheduleType: 'now',
  sendDate: '',
  sendTime: '',
  timezone: 'UTC',
  repeatInterval: 'weekly',
  repeatUntil: '',
  expiresAt: '',
  throttleMinSec: '',
  throttleMaxSec: '',
  batchSize: '',
  batchPauseMin: '',
  dailyLimit: '',
  windowStart: '',
  windowEnd: '',
  contactIds: [],
  groupIds: [],
  tagIds: [],
  segmentIds: [],
  manualNumbers: '',
  csvText: '',
};

/** Types whose message is typed in the builder. */
export const TYPES_WITH_BODY: readonly CampaignType[] = ['text', 'custom', 'button', 'media'];
export const isBodyType = (t: CampaignType) => TYPES_WITH_BODY.includes(t);

/** `button` and `media` campaigns edit as the rich custom message; the type they were saved with is kept. */
export const editorType = (t: CampaignType): 'text' | 'custom' | 'template' | 'flow' =>
  t === 'button' || t === 'media' ? 'custom' : t;

/** A mailbox sender (`email:<mailbox id>`): the form is an email campaign. */
export const isEmailKey = (senderKey: string): boolean => senderKey.startsWith('email:');

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

/** A date and a time for "in an hour" in `zone`, the default of a scheduled campaign. */
export function defaultSchedule(now: Date, zone: string): { sendDate: string; sendTime: string } {
  const at = new Date(now.getTime() + 60 * 60_000);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
  return {
    sendDate: `${g('year')}-${g('month')}-${g('day')}`,
    sendTime: `${g('hour')}:${g('minute')}`,
  };
}

/** The form of an existing campaign. The audience is its recipients. */
export function fromConfig(c: CampaignConfig, zone: string): BuilderForm {
  const buttons: ButtonRow[] = (c.customButtons ?? []).flatMap((b) => {
    const o = b as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text : typeof o.title === 'string' ? o.title : '';
    if (text === '') return [];
    const value = String(o.value ?? o.url ?? o.phone_number ?? '');
    const type =
      o.type === 'url' || o.type === 'phone_number' || o.type === 'copy_code'
        ? o.type
        : 'quick_reply';
    return [{ type, text, value } as ButtonRow];
  });
  return {
    ...EMPTY_FORM,
    name: c.name,
    senderKey: c.senderKey ?? '',
    type: c.type,
    customMessage: c.customMessage ?? '',
    customMessageB: c.customMessageB ?? '',
    customHeader: c.customHeader ?? '',
    customFooter: c.customFooter ?? '',
    buttons,
    mediaUrl: c.mediaUrl ?? '',
    templateId: c.templateId ?? '',
    templateIdB: c.templateIdB ?? '',
    templateOverrides: c.templateOverrides,
    templateOverridesB: c.templateOverridesB,
    flowId: c.flowId ?? '',
    flowIdB: c.flowIdB ?? '',
    abTesting: c.abTesting,
    abSplit: c.abSplit,
    trackingEnabled: c.trackingEnabled,
    retryFailed: c.retryFailed,
    scheduleType: c.scheduleType,
    sendDate: c.sendDate ?? '',
    sendTime: c.sendTime ?? '',
    timezone: c.timezone ?? zone,
    repeatInterval: c.repeatInterval ?? 'weekly',
    repeatUntil: c.repeatUntil ?? '',
    expiresAt: c.expiresAtLocal ?? '',
    throttleMinSec: c.throttleMinSec?.toString() ?? '',
    throttleMaxSec: c.throttleMaxSec?.toString() ?? '',
    batchSize: c.batchSize?.toString() ?? '',
    batchPauseMin: c.batchPauseMin?.toString() ?? '',
    dailyLimit: c.dailyLimit?.toString() ?? '',
    windowStart: c.windowStart ?? '',
    windowEnd: c.windowEnd ?? '',
    contactIds: c.recipientContactIds,
  };
}

const rowToButton = (b: ButtonRow) =>
  b.type === 'url'
    ? { type: 'url', text: b.text, url: b.value, value: b.value }
    : b.type === 'phone_number'
      ? { type: 'phone_number', text: b.text, phone_number: b.value, value: b.value }
      : b.type === 'copy_code'
        ? { type: 'copy_code', text: b.text, value: b.value }
        : { type: 'quick_reply', text: b.text, value: b.value || b.text };

/** The request body. Blank fields are left out (the server reads absent as "none"). */
export function toInput(f: BuilderForm, opts: { draft?: boolean } = {}): CreateCampaignInput {
  const body = isBodyType(f.type);
  const template = f.type === 'template';
  const scheduled = f.scheduleType !== 'now';
  // A mail carries a subject and a body only: the rest is left out (the server refuses a split test, a template, a flow or an attachment,
  // and clears the footer, buttons, pacing and click tracking).
  const email = isEmailKey(f.senderKey);
  const buttons = email ? [] : f.buttons.filter((b) => b.text.trim() !== '').map(rowToButton);
  const pace = (v: string) => (email ? null : num(v));
  return {
    name: f.name.trim(),
    senderKey: f.senderKey || null,
    type: f.type,
    status: opts.draft ? 'draft' : null,
    abTesting: email ? false : f.abTesting,
    abSplit: f.abSplit,
    customMessage: body ? f.customMessage : null,
    customMessageB:
      body && !email && f.abTesting && f.customMessageB.trim() !== '' ? f.customMessageB : null,
    customHeader: body && f.customHeader.trim() !== '' ? f.customHeader : null,
    customFooter: body && !email && f.customFooter.trim() !== '' ? f.customFooter : null,
    customButtons: body && buttons.length > 0 ? buttons : null,
    customQuickReplies: null,
    variableMap: null,
    mediaUrl: body && !email && f.mediaUrl.trim() !== '' ? f.mediaUrl.trim() : null,
    templateId: template && f.templateId ? f.templateId : null,
    templateIdA: null,
    templateIdB: template && f.abTesting && f.templateIdB ? f.templateIdB : null,
    templateOverrides: template ? f.templateOverrides : null,
    templateOverridesB: template && f.abTesting ? f.templateOverridesB : null,
    flowId: f.type === 'flow' && f.flowId ? f.flowId : null,
    flowIdB: f.type === 'flow' && f.abTesting && f.flowIdB ? f.flowIdB : null,
    useAttributes: false,
    trackingEnabled: email ? false : f.trackingEnabled,
    retryFailed: f.retryFailed,
    scheduleType: f.scheduleType,
    sendDate: scheduled && f.sendDate ? f.sendDate : null,
    sendTime: scheduled && f.sendTime ? f.sendTime : null,
    expiresAt: f.expiresAt || null,
    timezone: f.timezone || null,
    repeatInterval: f.scheduleType === 'recurring' ? f.repeatInterval : null,
    repeatUntil: f.scheduleType === 'recurring' && f.repeatUntil ? f.repeatUntil : null,
    throttleMinSec: pace(f.throttleMinSec),
    throttleMaxSec: pace(f.throttleMaxSec),
    batchSize: pace(f.batchSize),
    batchPauseMin: pace(f.batchPauseMin),
    dailyLimit: pace(f.dailyLimit),
    windowStart: email ? null : f.windowStart || null,
    windowEnd: email ? null : f.windowEnd || null,
    contactIds: f.contactIds,
    groupIds: f.groupIds,
    tagIds: f.tagIds,
    segmentIds: f.segmentIds,
    manualNumbers: f.manualNumbers,
    csvText: f.csvText,
  };
}

export type Problem =
  | 'name'
  | 'sender'
  | 'message'
  | 'template'
  | 'flow'
  | 'audience'
  | 'date'
  | 'time'
  | 'window'
  | 'throttle'
  | 'expiry'
  | 'media'
  | 'subject';

const isUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** What still stops the form from being saved, in the order the screen shows it. The server checks again. */
export function problems(f: BuilderForm, o: { draft?: boolean } = {}): Problem[] {
  const out: Problem[] = [];
  if (f.name.trim() === '') out.push('name');
  // Reference's builder starts on "Select a sender" and will not go on without one; a draft may still be saved without.
  if (f.senderKey === '' && !o.draft) out.push('sender');
  if (isBodyType(f.type) && f.customMessage.trim() === '') out.push('message');
  if (f.type === 'template' && f.templateId === '') out.push('template');
  if (f.type === 'flow' && f.flowId === '') out.push('flow');
  if (isBodyType(f.type) && f.mediaUrl.trim() !== '' && !isUrl(f.mediaUrl.trim()))
    out.push('media');
  if (isEmailKey(f.senderKey) && f.customHeader.length > CAMPAIGN_EMAIL_SUBJECT_MAX)
    out.push('subject');
  const audience =
    f.contactIds.length +
    f.groupIds.length +
    f.tagIds.length +
    f.segmentIds.length +
    f.manualNumbers.trim().length +
    f.csvText.trim().length;
  if (!o.draft && audience === 0) out.push('audience');
  if (f.scheduleType !== 'now') {
    if (f.sendDate === '') out.push('date');
    if (f.sendTime === '') out.push('time');
  }
  // A mail has no sending hours or gap between messages (they are cleared), so they cannot be wrong.
  if (!isEmailKey(f.senderKey)) {
    if ((f.windowStart === '') !== (f.windowEnd === '')) out.push('window');
    const min = num(f.throttleMinSec);
    const max = num(f.throttleMaxSec);
    if (min !== null && max !== null && max < min) out.push('throttle');
  }
  if (f.scheduleType !== 'now' && f.expiresAt !== '' && f.sendDate !== '') {
    if (f.expiresAt <= `${f.sendDate}T${f.sendTime || '00:00'}`) out.push('expiry');
  }
  return out;
}

/** The submit button's word: Launch for now, Schedule for later, Save for a recurring one. */
export const submitKey = (
  f: BuilderForm,
  editing: boolean,
): 'save' | 'launch' | 'schedule' | 'saveRecurring' =>
  editing
    ? 'save'
    : f.scheduleType === 'now'
      ? 'launch'
      : f.scheduleType === 'scheduled'
        ? 'schedule'
        : 'saveRecurring';

/** The text of a file the person picked, for the CSV field. */
export const readFileText = (file: File): Promise<string> => file.text();
