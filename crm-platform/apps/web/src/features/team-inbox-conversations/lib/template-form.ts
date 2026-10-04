import type { InboxTemplateOption } from '@crm/contracts';

/** The body as the customer will read it: each `{{n}}` replaced by what was typed, left as written while the slot is empty. */
export function previewBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => {
    const v = (values[key] ?? '').trim();
    return v === '' ? m : v;
  });
}

/** WhatsApp refuses a parameter with a line break, a tab or four spaces in a row (error 132018). */
const BAD_PARAMETER = /[\n\r\t]| {4,}/;

export type SlotProblem = 'required' | 'format';

/** What is wrong with each slot's value, by slot key; empty when the template may be sent. */
export function slotProblems(
  template: Pick<InboxTemplateOption, 'slots'>,
  values: Record<string, string>,
): Record<string, SlotProblem> {
  const problems: Record<string, SlotProblem> = {};
  for (const s of template.slots) {
    const v = (values[s.key] ?? '').trim();
    if (v === '') problems[s.key] = 'required';
    else if (BAD_PARAMETER.test(v)) problems[s.key] = 'format';
  }
  return problems;
}

/** The values to send: only the template's slots, trimmed. */
export function sendableValues(
  template: Pick<InboxTemplateOption, 'slots'>,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(template.slots.map((s) => [s.key, (values[s.key] ?? '').trim()]));
}
