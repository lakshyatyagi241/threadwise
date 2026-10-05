import type { InboxTemplateBlockReason, InboxTemplateSlot } from '@crm/contracts';
import { tokensOf, type VariableMap } from '../message-templates';

/**
 * What the inbox may send of a template, and what it needs from the agent. Pure, so the picker and the send are decided by the same
 * rules and the rules are tested without a database.
 *
 * The inbox fills the body's `{{1}}`, `{{2}}`... with text the agent types. A template that also needs a file, a variable in the
 * header or in a button link has nothing to take that from here, so it is blocked with a reason instead of being sent half-built (Meta
 * would refuse it with 132000/132012 and the agent would see a bare failure).
 */

/** The facts of a stored template the rules look at (a subset of the template repository's row). */
export interface TemplateFacts {
  status: string;
  metaStatus: string | null;
  pausedUntil: Date | null;
  templateType: string;
  attachmentType: string | null;
  header: string | null;
  templateBody: string;
  buttons: unknown;
  parameterFormat: string;
  variableMap: unknown;
}

/** `approved` (or WaDesk's global `public`) and, when Meta's own state is known, `APPROVED`. */
export function isApproved(t: Pick<TemplateFacts, 'status' | 'metaStatus'>): boolean {
  if (t.status !== 'approved' && t.status !== 'public') return false;
  return t.metaStatus === null || t.metaStatus === 'APPROVED';
}

/** The reason an approved template cannot be sent from the inbox, or null when it can. */
export function blockReason(t: TemplateFacts, now: Date): InboxTemplateBlockReason | null {
  if (t.pausedUntil && t.pausedUntil.getTime() > now.getTime()) return 'paused';
  if (t.templateType === 'auth') return 'authentication';
  if (t.parameterFormat === 'NAMED') return 'named_variables';
  const attachment = t.attachmentType ?? 'none';
  if (attachment !== 'none') return 'media_header';
  if (t.header && tokensOf(t.header).length > 0) return 'header_variable';
  if (buttonsOf(t.buttons).some((b) => b.url !== null && tokensOf(b.url).length > 0)) {
    return 'dynamic_button';
  }
  return null;
}

interface ButtonFacts {
  text: string;
  url: string | null;
}

/** Buttons are stored as loose JSON: read what a preview needs and nothing else. */
export function buttonsOf(raw: unknown): ButtonFacts[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b): ButtonFacts[] => {
    if (!b || typeof b !== 'object') return [];
    const o = b as Record<string, unknown>;
    return [
      {
        text: typeof o.text === 'string' ? o.text : '',
        url: typeof o.url === 'string' ? o.url : null,
      },
    ];
  });
}

/**
 * One slot per distinct `{{token}}` of the body, in order. Stored templates are positional (`{{1}}`), so the key is the token; the
 * label is the contact attribute the author mapped it to (`first_name`) when there is one, else "Variable 1".
 */
export function bodySlots(body: string, variableMap: unknown): InboxTemplateSlot[] {
  const mapped = (variableMap as VariableMap | null)?.body ?? [];
  return tokensOf(body).map((key, i) => {
    const slot = mapped.find((s) => s.num === i + 1);
    const named = slot && !/^\d+$/.test(slot.key) ? slot.key : null;
    return {
      key,
      label: named ? named.replace(/_/g, ' ') : `Variable ${i + 1}`,
      example: slot?.example ?? null,
    };
  });
}

export interface VariableProblem {
  key: string;
  message: string;
}

/** WhatsApp refuses a body parameter with a line break, a tab or four spaces in a row (error 132018); say so before sending. */
const BAD_PARAMETER = /[\n\r\t]| {4,}/;

/** What is wrong with the values the agent typed, per slot; empty when the send may go ahead. */
export function checkVariables(
  slots: readonly InboxTemplateSlot[],
  variables: Record<string, string>,
): VariableProblem[] {
  const problems: VariableProblem[] = [];
  for (const s of slots) {
    const v = (variables[s.key] ?? '').trim();
    if (v === '') problems.push({ key: s.key, message: `${s.label} is required` });
    else if (BAD_PARAMETER.test(v)) {
      problems.push({
        key: s.key,
        message: `${s.label} cannot contain a line break, a tab or four spaces in a row`,
      });
    }
  }
  return problems;
}

/** Only the slots the template has, trimmed: what the send carries and what the thread shows. */
export function cleanVariables(
  slots: readonly InboxTemplateSlot[],
  variables: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(slots.map((s) => [s.key, (variables[s.key] ?? '').trim()]));
}

/** The body as the customer reads it: each `{{token}}` replaced by its value. A token without a value is left as written. */
export function renderBody(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, t: string) => variables[t] ?? m);
}
