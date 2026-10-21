import type {
  ReminderPack,
  ReminderPackKey,
  ReminderPackLanguage,
  ReminderPackPreview,
  ReminderPackStep,
} from '@crm/contracts';
import { splitMinutes, type ReminderUnit } from './reminder-rules';

/**
 * Reminder packs on the screen (BL-424): the sample values a preview is filled with, what a step of a pack does to the booking type, and
 * whether "Apply" may be pressed. No React in here. The texts themselves come from the API (`/appointment-reminder-packs/:key/preview`),
 * so a change of wording needs no change here.
 */

export const PACK_LANGUAGES: readonly ReminderPackLanguage[] = ['en', 'hi'];

/** The values a message is previewed with. The owner can edit them to see a longer name or a different place. */
export interface SampleValues {
  /** The contact's name. */
  name: string;
  /** The service (the booking type's name). */
  service: string;
  date: string;
  time: string;
  /** The place, as `{{location}}`. */
  place: string;
  join_link: string;
  manage_link: string;
}

export const SAMPLE_KEYS = [
  'name',
  'service',
  'date',
  'time',
  'place',
  'join_link',
  'manage_link',
] as const satisfies readonly (keyof SampleValues)[];

/** Sample content in the language of the message, not of the screen: it shows what the contact would read. */
const SAMPLES: Record<ReminderPackLanguage, Omit<SampleValues, 'service'>> = {
  en: {
    name: 'Alex',
    date: 'Tuesday, 15 January',
    time: '10:00 AM',
    place: '12 Main Street',
    join_link: 'https://meet.example.com/abc-defg',
    manage_link: 'https://example.com/manage/xyz',
  },
  hi: {
    name: 'आर्यन',
    date: 'मंगलवार, 15 जनवरी',
    time: '10:00 बजे',
    place: '12 मेन स्ट्रीट',
    join_link: 'https://meet.example.com/abc-defg',
    manage_link: 'https://example.com/manage/xyz',
  },
};

/** The email-only placeholders (WhatsApp cannot use them). */
const EXTRA = {
  host_name: 'Sam Rivera',
  host_phone: '+91 98765 43210',
  map_link: 'https://maps.example.com/?q=12+Main+Street',
} as const;

export function defaultSample(language: ReminderPackLanguage, service: string): SampleValues {
  return { ...SAMPLES[language], service: service.trim() };
}

/**
 * Packs whose messages never name the service: the pack sets `serviceLabel`, so `{{type}}` reads "appointment" (a medical practice does
 * not want a treatment named in a text message). Mirrors the packs' own data; the stored label wins at send time.
 */
const SERVICE_WORD: Partial<Record<ReminderPackKey, Record<ReminderPackLanguage, string>>> = {
  clinic: { en: 'appointment', hi: 'अपॉइंटमेंट' },
  dental: { en: 'appointment', hi: 'अपॉइंटमेंट' },
};

/** Fills a pack message with sample values the way the sender does: a name it does not know stays as written. */
export function fillSample(
  text: string,
  values: SampleValues,
  ctx: { pack: ReminderPackKey; language: ReminderPackLanguage },
): string {
  const type = SERVICE_WORD[ctx.pack]?.[ctx.language] ?? (values.service || '…');
  const map: Record<string, string> = {
    name: values.name,
    type,
    title: type,
    slot: `${values.date} · ${values.time}`,
    date: values.date,
    time: values.time,
    location: values.place,
    join_link: values.join_link,
    manage_link: values.manage_link,
    ...EXTRA,
  };
  return text.replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (whole, key: string) => map[key.toLowerCase()] ?? whole,
  );
}

/** When a step of a pack goes out, for its line: an event, or an amount of time before or after. */
export type PackWhen =
  { side: 'event' } | { side: 'before' | 'after'; count: number; unit: ReminderUnit };

export function packStepWhen(step: Pick<ReminderPackStep, 'kind' | 'offsetMinutes'>): PackWhen {
  if (step.kind === 'event') return { side: 'event' };
  const { offset, unit } = splitMinutes(step.offsetMinutes);
  return { side: step.kind, count: Number(offset), unit };
}

/** Why "Apply" cannot be pressed yet, in the order the person should fix it. */
export type ApplyBlock = 'readOnly' | 'unsaved' | 'cap' | 'confirm' | 'loading' | null;

export function applyBlock(input: {
  canEdit: boolean;
  /** The reminder steps of the booking type have changes that are not saved: applying would make the screen disagree with the server. */
  dirty: boolean;
  preview: ReminderPackPreview | undefined;
  confirmed: boolean;
}): ApplyBlock {
  if (!input.canEdit) return 'readOnly';
  if (input.dirty) return 'unsaved';
  if (!input.preview) return 'loading';
  if (input.preview.blocked === 'cap_exceeded') return 'cap';
  if (input.preview.needsConfirm && !input.confirmed) return 'confirm';
  return null;
}

/** How many steps the pack adds, replaces and leaves alone, for the summary line. */
export function previewCounts(preview: ReminderPackPreview): {
  add: number;
  replace: number;
  unchanged: number;
} {
  const out = { add: 0, replace: 0, unchanged: 0 };
  for (const s of preview.steps) out[s.action] += 1;
  return out;
}

/** How many templates still wait for Meta (so the screen can say those steps use email meanwhile). */
export function waitingTemplates(statuses: readonly string[]): number {
  return statuses.filter((s) => s === 'pending' || s === 'draft').length;
}

/** Whether a pack makes WhatsApp templates this workspace does not have yet. */
export function newTemplates(preview: ReminderPackPreview): number {
  return preview.steps.filter((s) => s.whatsapp.status === 'new').length;
}

/** The pack of a key from the list, or undefined (a pack from a newer server is listed but has no translated blurb). */
export const packOf = (packs: readonly ReminderPack[], key: ReminderPackKey | null) =>
  packs.find((p) => p.key === key);
