import type { TemplateDetail, VariableSlot } from '../api/pending-contracts';

/**
 * Sending a template from a conversation: which variables a template asks for, what the person types, and the preview that shows
 * the message as the customer will read it. Pure, so the picker's form and its tests share it.
 *
 * Variables go to the send as a record keyed by the placeholder number (`"1"`, `"2"`) for the body and `header.<n>` for a text
 * header, which is how a template's own text numbers them (`{{1}}`).
 */
export const VARIABLE_MAX = 1024;

export type SlotScope = 'header' | 'body';

export interface Slot {
  scope: SlotScope;
  num: number;
  /** The key of the record the send carries. */
  field: string;
  /** What the slot is called: the contact attribute it reads from when it has one, else its number. */
  name: string | null;
}

const TOKEN = /\{\{\s*(\d+)\s*\}\}/g;

export const slotField = (scope: SlotScope, num: number): string =>
  scope === 'header' ? `header.${num}` : String(num);

const isNumeric = (s: string) => /^\d+$/.test(s);

function fromMap(scope: SlotScope, slots: readonly VariableSlot[]): Slot[] {
  return slots.map((s) => ({
    scope,
    num: s.num,
    field: slotField(scope, s.num),
    name: s.key && !isNumeric(s.key) ? s.key : null,
  }));
}

/** Placeholder numbers that appear in a text, in order, each once. */
export function placeholdersOf(text: string | null | undefined): number[] {
  const seen: number[] = [];
  for (const m of (text ?? '').matchAll(TOKEN)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/**
 * The slots a template asks for: from its variable map when it has one, else from the numbered placeholders of its text (a template
 * synced from Meta has no map). Header first, then body, each by number.
 */
export function slotsOf(t: Pick<TemplateDetail, 'header' | 'body' | 'variableMap'>): Slot[] {
  const out: Slot[] = [];
  for (const scope of ['header', 'body'] as const) {
    const mapped = t.variableMap?.[scope];
    const text = scope === 'header' ? t.header : t.body;
    if (mapped && mapped.length > 0) out.push(...fromMap(scope, mapped));
    else
      out.push(
        ...placeholdersOf(text).map((num) => ({
          scope,
          num,
          field: slotField(scope, num),
          name: null,
        })),
      );
  }
  return out.sort((a, b) => (a.scope === b.scope ? a.num - b.num : a.scope === 'header' ? -1 : 1));
}

export type SlotIssue = 'empty' | 'tooLong';

/** What is wrong with the typed values, by field; nothing when the template can be sent. */
export function slotIssues(
  slots: readonly Slot[],
  values: Readonly<Record<string, string>>,
): Record<string, SlotIssue> {
  const out: Record<string, SlotIssue> = {};
  for (const s of slots) {
    const v = (values[s.field] ?? '').trim();
    if (v === '') out[s.field] = 'empty';
    else if (v.length > VARIABLE_MAX) out[s.field] = 'tooLong';
  }
  return out;
}

/** The `variables` of the send: trimmed, only the template's own slots. */
export function variablesFor(
  slots: readonly Slot[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(slots.map((s) => [s.field, (values[s.field] ?? '').trim()]));
}

/** The text with each placeholder replaced by what was typed; one with no value yet stays as `{{n}}`. */
export function fillText(
  text: string | null | undefined,
  scope: SlotScope,
  values: Readonly<Record<string, string>>,
): string {
  return (text ?? '').replace(TOKEN, (whole, n: string) => {
    const v = (values[slotField(scope, Number(n))] ?? '').trim();
    return v === '' ? whole : v;
  });
}

/** Only an approved template can be sent; a draft, a pending, a rejected, a paused one cannot. */
export const isSendable = (status: string): boolean => status === 'approved';
