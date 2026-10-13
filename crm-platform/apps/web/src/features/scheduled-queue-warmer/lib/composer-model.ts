import {
  scheduleMediaProblem,
  type CreateScheduleInput,
  type ScheduleDraft,
  type ScheduleMedia,
  type ScheduleOptions,
  type UpdateScheduleInput,
} from '@crm/contracts';
import { localDateTime, parseTime, wallToEpoch } from './time';

/** The pure half of the five-step composer (TW-SCHED-003 to 007): the draft, its step checks, and the draft to request mapping. */

type MessageType = CreateScheduleInput['messageType'];
type RecipientType = CreateScheduleInput['recipientType'];

export const STEPS = ['basics', 'audience', 'message', 'schedule', 'review'] as const;
export type Step = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: Step = 5;
/** The plain message limit the reference's counter shows. */
export const PLAIN_LIMIT = 1024;
/** Sunday first, as the contract numbers them. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export interface Draft {
  name: string;
  senders: string[];
  messageType: MessageType;
  recipientType: RecipientType;
  groupIds: string[];
  tagIds: string[];
  queueIds: string[];
  numbersText: string;
  message: string;
  templateId: string;
  /** What was typed in the template's variable panel (null: the template's own values). */
  templateOverrides: Record<string, unknown> | null;
  media: string;
  /** An uploaded file; wins over the pasted link. */
  mediaFile: ScheduleMedia | null;
  latitude: string;
  longitude: string;
  scheduleType: 'once' | 'recurring';
  sendDate: string;
  sendTime: string;
  timezone: string;
  repeatInterval: 'daily' | 'weekly' | 'monthly';
  repeatEvery: string;
  daysOfWeek: number[];
  endMode: 'never' | 'date';
  endDate: string;
  sendTest: boolean;
  testNumber: string;
}

/** A new draft: today, ten minutes from now on the wall clock of `timezone`, one sender pre-ticked when it is the only one. */
export function initialDraft(now: number, timezone: string, senders: string[] = []): Draft {
  const at = localDateTime(now + 10 * 60_000, timezone);
  return {
    name: '',
    senders: senders.length === 1 ? senders : [],
    messageType: 'plain',
    recipientType: 'group',
    groupIds: [],
    tagIds: [],
    queueIds: [],
    numbersText: '',
    message: '',
    templateId: '',
    templateOverrides: null,
    media: '',
    mediaFile: null,
    latitude: '',
    longitude: '',
    scheduleType: 'once',
    sendDate: at.date,
    sendTime: at.time,
    timezone,
    repeatInterval: 'weekly',
    repeatEvery: '1',
    daysOfWeek: [],
    endMode: 'never',
    endDate: '',
    sendTest: false,
    testNumber: '',
  };
}

/** Numbers pasted one per line or comma separated, reduced to digits, without blanks or repeats. */
export function parseNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const part of text.split(/[\n,;]+/)) {
    const digits = part.replace(/\D+/g, '');
    if (digits) out.add(digits);
  }
  return [...out];
}

const digitsOnly = (s: string) => s.replace(/\D+/g, '');

/** What the audience preview needs: only the ids of the chosen source. */
export function audienceInput(d: Draft) {
  return {
    recipientType: d.recipientType,
    groupIds: d.recipientType === 'group' ? d.groupIds : undefined,
    tagIds: d.recipientType === 'tag' ? d.tagIds : undefined,
    queueIds: d.recipientType === 'queue' ? d.queueIds : undefined,
    numbers: d.recipientType === 'number' ? parseNumbers(d.numbersText) : undefined,
  };
}

export function audienceCount(d: Draft): number {
  switch (d.recipientType) {
    case 'group':
      return d.groupIds.length;
    case 'tag':
      return d.tagIds.length;
    case 'queue':
      return d.queueIds.length;
    case 'number':
      return parseNumbers(d.numbersText).length;
  }
}

/** The request the server takes. Fields that do not apply to the chosen type are left out. */
export function toCreateInput(d: Draft): CreateScheduleInput {
  const recurring = d.scheduleType === 'recurring';
  const body: CreateScheduleInput = {
    name: d.name.trim(),
    scheduleType: d.scheduleType,
    sendDate: d.sendDate,
    sendTime: d.sendTime.trim(),
    timezone: d.timezone,
    senders: d.senders,
    messageType: d.messageType,
    ...audienceInput(d),
  };
  if (d.messageType === 'plain' || d.messageType === 'media') body.message = d.message;
  if (d.messageType === 'template') {
    body.templateId = d.templateId;
    if (d.templateOverrides) body.templateOverrides = d.templateOverrides;
  }
  if (d.messageType === 'media') {
    if (d.mediaFile) body.mediaId = d.mediaFile.id;
    else body.media = d.media.trim();
  }
  if (d.messageType === 'location') {
    body.latitude = Number(d.latitude);
    body.longitude = Number(d.longitude);
  }
  if (recurring) {
    body.repeatInterval = d.repeatInterval;
    body.repeatEvery = Number(d.repeatEvery);
    if (d.repeatInterval === 'weekly') body.daysOfWeek = [...d.daysOfWeek].sort((a, b) => a - b);
    if (d.endMode === 'date' && d.endDate) body.endDate = d.endDate;
  }
  if (d.sendTest && digitsOnly(d.testNumber)) body.testNumber = digitsOnly(d.testNumber);
  return body;
}

/**
 * The edit request (TW-SCHED-016): the whole composer, so the server replaces message and audience as given, plus the version that was
 * opened. One schedule is one sender, so `sender` is the single number ticked.
 */
export function toUpdateInput(d: Draft, rowVersion: number): UpdateScheduleInput {
  const c = toCreateInput(d);
  const recurring = d.scheduleType === 'recurring';
  const { senders: _senders, testNumber: _test, ...rest } = c;
  void _senders;
  void _test;
  return {
    ...rest,
    sender: d.senders[0],
    rowVersion,
    ...(recurring ? { endDate: d.endMode === 'date' && d.endDate ? d.endDate : null } : {}),
  };
}

/** The composer's draft for a stored schedule (the edit screen). */
export function draftFromSchedule(s: ScheduleDraft): Draft {
  return {
    name: s.name,
    senders: s.sender ? [s.sender] : [],
    messageType: s.messageType,
    recipientType: s.recipientType,
    groupIds: s.groupIds,
    tagIds: s.tagIds,
    queueIds: s.queueIds,
    numbersText: s.numbers.join('\n'),
    message: s.message,
    templateId: s.templateId ?? '',
    templateOverrides: s.templateOverrides,
    media: s.media ?? '',
    mediaFile: s.mediaFile,
    latitude: s.latitude === null ? '' : String(s.latitude),
    longitude: s.longitude === null ? '' : String(s.longitude),
    scheduleType: s.scheduleType,
    sendDate: s.sendDate,
    sendTime: s.sendTime,
    timezone: s.timezone,
    repeatInterval: s.repeatInterval ?? 'weekly',
    repeatEvery: String(s.repeatEvery),
    daysOfWeek: s.daysOfWeek,
    endMode: s.endDate ? 'date' : 'never',
    endDate: s.endDate ?? '',
    sendTest: false,
    testNumber: '',
  };
}

export interface CheckContext {
  options: Pick<ScheduleOptions, 'senders' | 'templates' | 'minLeadMinutes'>;
  /** Editing a schedule whose time was not touched: it may already be past due (a paused one), so the lead time is not asked of it. */
  skipLead?: boolean;
  now: number;
}

/** Error codes (keys under `composer.errors`) by the field path the server would use, for one step. */
export type StepErrors = Record<string, string>;

const HTTPS = /^https?:\/\/\S+$/i;

export function validateStep(d: Draft, step: Step, ctx: CheckContext): StepErrors {
  const e: StepErrors = {};
  if (step === 1) {
    if (!d.name.trim()) e.name = 'nameRequired';
    if (d.senders.length === 0) e.senders = 'senderRequired';
    else if (d.messageType === 'template' && d.templateId) {
      // A Cloud API number sends only a template Meta approved; the others send the approved text.
      const tpl = ctx.options.templates.find((x) => x.id === d.templateId);
      const engines = d.senders.map((k) => ctx.options.senders.find((s) => s.key === k)?.engine);
      if (
        tpl &&
        engines.some((en) => en && !tpl.usableOn.includes(en as 'waba' | 'twilio' | 'baileys'))
      ) {
        e.senders = 'templateNotForSender';
      }
    }
  }
  if (step === 2) {
    const field = { group: 'groupIds', tag: 'tagIds', queue: 'queueIds', number: 'numbers' }[
      d.recipientType
    ];
    if (audienceCount(d) === 0)
      e[field] = d.recipientType === 'number' ? 'numbersRequired' : 'audienceRequired';
  }
  if (step === 3) {
    if (d.messageType === 'plain') {
      if (!d.message.trim()) e.message = 'messageRequired';
      else if (d.message.length > PLAIN_LIMIT) e.message = 'messageTooLong';
    } else if (d.messageType === 'template') {
      if (!d.templateId) e.templateId = 'templateRequired';
    } else if (d.messageType === 'media') {
      if (d.mediaFile) {
        // The file against every channel it goes through, before anything is saved.
        for (const key of d.senders) {
          const engine = ctx.options.senders.find((s) => s.key === key)?.engine;
          const problem = engine && scheduleMediaProblem(engine, d.mediaFile);
          if (problem) {
            e.media = problem.code === 'too_large' ? 'mediaTooLarge' : 'mediaType';
            break;
          }
        }
      } else if (!HTTPS.test(d.media.trim())) e.media = 'mediaLink';
    } else {
      const lat = Number(d.latitude);
      const lng = Number(d.longitude);
      if (d.latitude.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90)
        e.latitude = 'latitude';
      if (d.longitude.trim() === '' || !Number.isFinite(lng) || lng < -180 || lng > 180)
        e.longitude = 'longitude';
    }
  }
  if (step === 4) {
    if (!d.sendDate) e.sendDate = 'dateRequired';
    if (parseTime(d.sendTime) === null) e.sendTime = 'timeRequired';
    if (!d.timezone) e.timezone = 'timezoneRequired';
    if (!e.sendDate && !e.sendTime && !e.timezone) {
      const at = wallToEpoch(d.sendDate, d.sendTime, d.timezone);
      if (at === null) e.sendTime = 'timeRequired';
      else if (at < ctx.now + ctx.options.minLeadMinutes * 60_000 && !ctx.skipLead)
        e.sendTime = 'tooSoon';
    }
    if (d.scheduleType === 'recurring') {
      const every = Number(d.repeatEvery);
      if (!Number.isInteger(every) || every < 1 || every > 365) e.repeatEvery = 'repeatEvery';
      if (d.repeatInterval === 'weekly' && d.daysOfWeek.length === 0) e.daysOfWeek = 'daysRequired';
      if (d.endMode === 'date') {
        if (!d.endDate) e.endDate = 'endDateRequired';
        else if (d.sendDate && d.endDate < d.sendDate) e.endDate = 'endBeforeStart';
      }
    }
  }
  if (step === 5 && d.sendTest && digitsOnly(d.testNumber).length < 8) e.testNumber = 'testNumber';
  return e;
}

/** The first step with a problem, for the "Next" and "Schedule" buttons; null when the whole draft is fine. */
export function firstInvalidStep(d: Draft, ctx: CheckContext): Step | null {
  for (const s of [1, 2, 3, 4, 5] as const)
    if (Object.keys(validateStep(d, s, ctx)).length) return s;
  return null;
}

const STEP_OF_FIELD: Record<string, Step> = {
  name: 1,
  senders: 1,
  messageType: 1,
  recipientType: 2,
  groupIds: 2,
  tagIds: 2,
  queueIds: 2,
  numbers: 2,
  message: 3,
  templateId: 3,
  templateOverrides: 3,
  media: 3,
  latitude: 3,
  longitude: 3,
  scheduleType: 4,
  sendDate: 4,
  sendTime: 4,
  timezone: 4,
  repeatInterval: 4,
  repeatEvery: 4,
  daysOfWeek: 4,
  endDate: 4,
  testNumber: 5,
};

/** The earliest step that holds a field the server rejected; null when none of the paths is one of ours. */
export function stepOfServerErrors(errors: Array<{ path: string }>): Step | null {
  let first: Step | null = null;
  for (const { path } of errors) {
    const step = STEP_OF_FIELD[path.split(/[.[]/)[0] ?? ''];
    if (step && (first === null || step < first)) first = step;
  }
  return first;
}

/** The server's message for a field (`senders.0` counts for `senders`), shown next to it. */
export function serverFieldError(
  errors: Array<{ path: string; message: string }>,
  field: string,
): string | undefined {
  return errors.find(
    (x) => x.path === field || x.path.startsWith(`${field}.`) || x.path.startsWith(`${field}[`),
  )?.message;
}

/** The sender label for the review step. */
export const senderLabels = (
  keys: string[],
  senders: Array<{ key: string; label: string }>,
): string => keys.map((k) => senders.find((s) => s.key === k)?.label ?? k).join(', ');

/** Seconds to send `n` messages at the reference's 60 per minute, as minutes (rounded up). */
export const estimateMinutes = (n: number) => Math.ceil(n / 60);
