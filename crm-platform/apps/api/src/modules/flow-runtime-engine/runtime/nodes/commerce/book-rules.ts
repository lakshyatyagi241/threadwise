import type { InboundReply } from '../../types';

/** Pure rules of the Book appointment node (WD-FLR-040): what is offered, how an answer is read back, how a question is checked. */

/** Cloud API list cap: rows beyond ten are not shown, so they are not offered (WaDesk cut at ten the same way). */
export const CHOICE_ROWS_MAX = 10;

export interface Choice {
  id: string;
  title: string;
  desc?: string;
  /** What picking it means. */
  type?: string;
  day?: string;
  start?: string;
  end?: string;
  /** A paging row: `more` shows the next page of `day` or `slot`, `back` goes one page (or one level) back. */
  special?: boolean;
  more?: 'day' | 'slot';
  back?: 'day' | 'slot';
}

export interface BookQuestion {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  mapToContactField: string | null;
}

/** What the node remembers between the customer's answers (it is stored on the run's wait). */
export interface BookContext {
  confirmation: string;
  typeId?: string;
  typeName?: string;
  dayOffset: number;
  slotOffset: number;
  nextDayOffset?: number;
  nextSlotOffset?: number;
  day?: string;
  dayLabel?: string;
  slotStart?: string;
  slotLabel?: string;
  reservationId?: string;
  questions: BookQuestion[];
  introMessage?: string;
  qIndex: number;
  /** Keyed by question id: what the booking stores. */
  answers: Record<string, string>;
  email?: string;
  dueNow: number;
  currency: string;
  hasGateway: boolean;
}

export type BookStage = 'CHOOSE_TYPE' | 'CHOOSE_DAY' | 'CHOOSE_SLOT' | 'ASK_QUESTIONS';

export interface BookWait {
  stage: BookStage;
  ctx: BookContext;
  choices: Choice[];
}

/**
 * Matches a reply back to what was offered (WD-FLR-040 rule 5): the row id, then the label (clients cut a title to 24 characters, so
 * a prefix matches), then a typed number counted over the rows the customer was shown.
 */
export function decodeChoice(reply: InboundReply, choices: Choice[]): Choice | null {
  const byId = reply.id ? choices.find((c) => c.id === reply.id) : undefined;
  if (byId) return byId;
  const text = reply.text.trim();
  if (text !== '') {
    const byTitle = choices.find(
      (c) => c.title === text || c.title.startsWith(text) || c.title.slice(0, 24) === text,
    );
    if (byTitle) return byTitle;
    if (/^\d+$/.test(text)) {
      const n = parseInt(text, 10);
      if (n >= 1 && n <= choices.length) return choices[n - 1]!;
    }
  }
  return null;
}

/** The list the customer is shown, cut to what a channel lists. */
export const shown = (rows: Choice[]): Choice[] => rows.slice(0, CHOICE_ROWS_MAX);

/** A flow variable name for an answer: the question's label, lower case, words joined by `_`, at most 40 characters. */
export function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** The line that asks one question: the intro before the first, "(optional - reply "skip")" on an optional one, numbered options. */
export function questionPrompt(ctx: BookContext): string {
  const q = ctx.questions[ctx.qIndex]!;
  let prompt = '';
  if (ctx.qIndex === 0 && ctx.introMessage) prompt += `${ctx.introMessage}\n\n`;
  prompt += q.label || 'Please reply';
  if (!q.required) prompt += ' (optional — reply "skip")';
  if (q.type === 'select' && q.options && q.options.length > 0) {
    prompt += `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  }
  return prompt;
}

export type AnswerCheck = { ok: true; value: string } | { ok: false; say: string };

/** One answer to one question (WD-FLR-040 rule 7): "skip" clears an optional one, a select takes its number or text, an email is checked. */
export function checkAnswer(q: BookQuestion, raw: string): AnswerCheck {
  let ans = raw.trim();
  if (!q.required && /^skip$/i.test(ans)) ans = '';
  if (q.type === 'select' && q.options && q.options.length > 0 && ans !== '') {
    if (/^\d+$/.test(ans)) {
      const n = parseInt(ans, 10);
      if (n >= 1 && n <= q.options.length) ans = q.options[n - 1]!;
    } else {
      const hit = q.options.find((o) => o.toLowerCase() === ans.toLowerCase());
      if (hit) ans = hit;
    }
  }
  if (q.required && ans === '') return { ok: false, say: `Please answer: ${q.label}` };
  if (q.type === 'email' && ans !== '' && !/^\S+@\S+\.\S+$/.test(ans)) {
    return { ok: false, say: "That doesn't look like an email — try again." };
  }
  return { ok: true, value: ans };
}

/** The confirmation text: `{{slot}}`, `{{type}}` and `{{manage_link}}` filled in; without `{{manage_link}}` the link is added as a line. */
export function confirmationText(
  template: string,
  slot: string,
  typeName: string,
  manageUrl: string,
): string {
  let text = template
    .replace(/\{\{\s*slot\s*\}\}/gi, slot)
    .replace(/\{\{\s*type\s*\}\}/gi, typeName || 'your booking');
  if (manageUrl !== '') {
    text = /\{\{\s*manage_link\s*\}\}/i.test(text)
      ? text.replace(/\{\{\s*manage_link\s*\}\}/gi, manageUrl)
      : `${text}\n\nReschedule or cancel: ${manageUrl}`;
  }
  return text;
}
