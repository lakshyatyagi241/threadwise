import {
  FREQUENCY_CAP_ERROR_CODE,
  WIZARD_RETRY_INTERVAL_HOURS,
  type WizardSchedule,
  type WizardTemplateSlot,
  type WizardVariableSource,
  type WizardVariables,
} from '@crm/contracts';
import type { SendVars } from '../../../infra/providers/whatsapp/meta-send-payload';
import {
  buttonAddress,
  buttonExample,
  kindOfButton,
} from '../../../infra/providers/whatsapp/template-vocab';
import { resolveToken, type MergeContext } from '../../crm';

/** The pure rules of the broadcast wizard. Nothing here reads a database or a clock it was not given. */

type Dict = Record<string, unknown>;
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : isDict(x) ? Object.values(x) : []);
const text = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

// ------------------------------------------------------------------------------------------------ template slots

/** The `{{...}}` placeholders of a text, in order of first appearance, each once. */
export function tokensOf(s: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const m of (s ?? '').matchAll(/\{\{\s*([^\s{}]+?)\s*\}\}/g)) seen.add(m[1]!);
  return [...seen];
}

interface SlotEntry {
  num: number;
  key: string;
  example: string | null;
}

/** `{ num, key, example }` entries of one section of a stored variable map, whichever of the stored shapes it came in. */
function entriesOf(section: unknown): SlotEntry[] {
  return list(section).flatMap((e, i): SlotEntry[] => {
    if (isDict(e)) {
      const num = e.num !== undefined ? Number(e.num) : i + 1;
      return Number.isInteger(num) && num >= 1 && num <= 99
        ? [{ num, key: text(e.key), example: text(e.example) || null }]
        : [];
    }
    const key = text(e);
    return key ? [{ num: i + 1, key, example: null }] : [];
  });
}

/** Slots from the tokens of a text when the template's map does not list them (a positional `{{2}}` is slot 2, a named one takes its order). */
function slotsFromTokens(s: string | null | undefined): SlotEntry[] {
  return tokensOf(s).map((t, i) => {
    const positional = /^\d+$/.test(t);
    return { num: positional ? Number(t) : i + 1, key: positional ? '' : t, example: null };
  });
}

export interface TemplateLike {
  templateBody: string;
  header: string | null;
  variableMap: unknown;
  buttons: unknown;
}

/**
 * The placeholders a template asks to be filled: `header.1`, `body.1`..., and `button.<position>` for a link button whose address
 * carries one. What the template's own map names wins; a placeholder in the text the map does not list is added, so a template
 * imported without a map still can be filled.
 */
export function templateSlots(t: TemplateLike): WizardTemplateSlot[] {
  const map = isDict(t.variableMap) ? t.variableMap : {};
  const out: WizardTemplateSlot[] = [];
  for (const section of ['header', 'body'] as const) {
    const fromMap = entriesOf(map[section]);
    const fromText = slotsFromTokens(section === 'header' ? t.header : t.templateBody);
    const byNum = new Map<number, SlotEntry>();
    for (const e of fromText) byNum.set(e.num, e);
    for (const e of fromMap) byNum.set(e.num, { ...byNum.get(e.num), ...e });
    for (const e of [...byNum.values()].sort((a, b) => a.num - b.num)) {
      out.push({
        slot: `${section}.${e.num}` as WizardTemplateSlot['slot'],
        section,
        position: e.num,
        key: e.key,
        example: e.example,
      });
    }
  }
  list(t.buttons).forEach((b, i) => {
    if (!isDict(b) || kindOfButton(b) !== 'url') return;
    const address = buttonAddress(b);
    if (!/\{\{/.test(address)) return;
    const example = buttonExample(b);
    out.push({
      slot: `button.${i}` as WizardTemplateSlot['slot'],
      section: 'button',
      position: i,
      key: '',
      example: example || null,
    });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ resolving a mapping

export interface ResolvedSlot {
  value: string;
  /** No value for this contact and no fallback: the text goes out blank (the provider layer then falls back to the example). */
  empty: boolean;
}

/** One placeholder for one contact: a field's value, else the fallback; or the fixed text. Never the braces. */
export function resolveSource(source: WizardVariableSource, ctx: MergeContext): ResolvedSlot {
  if (source.kind === 'fixed') return { value: source.text, empty: false };
  const got = resolveToken(source.field, ctx).value;
  if (got !== '') return { value: got, empty: false };
  const fallback = (source.fallback ?? '').trim();
  return { value: fallback, empty: fallback === '' };
}

export interface ResolvedMapping {
  /** Value per slot. A slot with no source is absent. */
  values: Record<string, string>;
  /** Slots that came out blank for this contact. */
  empty: string[];
  /** Slots the template has and the mapping does not cover. */
  unmapped: string[];
}

export function resolveMapping(
  slots: readonly WizardTemplateSlot[],
  variables: WizardVariables,
  ctx: MergeContext,
): ResolvedMapping {
  const values: Record<string, string> = {};
  const empty: string[] = [];
  const unmapped: string[] = [];
  for (const s of slots) {
    const source = variables[s.slot];
    if (!source) {
      unmapped.push(s.slot);
      continue;
    }
    const r = resolveSource(source, ctx);
    values[s.slot] = r.value;
    if (r.empty) empty.push(s.slot);
  }
  return { values, empty, unmapped };
}

/** The slots with no source in the mapping. */
export function unmappedSlots(
  slots: readonly WizardTemplateSlot[],
  variables: WizardVariables,
): string[] {
  return slots.filter((s) => !variables[s.slot]).map((s) => s.slot);
}

/**
 * A template text with its placeholders replaced by what each slot resolved to, for the sample messages and the test log. A positional
 * `{{2}}` takes slot 2; a named one takes the slot whose template key it is, else its order. A placeholder with no value stays out
 * (never the raw braces).
 */
export function fillText(
  s: string | null,
  section: 'header' | 'body',
  slots: readonly WizardTemplateSlot[],
  values: Record<string, string>,
): string | null {
  if (s === null) return null;
  const mine = slots.filter((x) => x.section === section);
  const named = tokensOf(s).filter((t) => !/^\d+$/.test(t));
  return s.replace(/\{\{\s*([^\s{}]+?)\s*\}\}/g, (_m, token: string) => {
    if (/^\d+$/.test(token)) return values[`${section}.${Number(token)}`] ?? '';
    const byKey = mine.find((x) => x.key === token);
    const slot = byKey ?? mine[named.indexOf(token)];
    return slot ? (values[slot.slot] ?? '') : '';
  });
}

/**
 * The wizard's mapping laid over the per-recipient variables the template built: header text, the body in slot order, and a link
 * button's parameter. Only the slots the mapping covers are touched, so a template part the wizard does not model keeps the value
 * the template already produced.
 */
export function applyWizardVariables(
  vars: SendVars,
  slots: readonly WizardTemplateSlot[],
  values: Record<string, string>,
): SendVars {
  const out: SendVars = { ...vars };
  const header = slots.find((s) => s.section === 'header');
  if (header && header.slot in values) out.header = values[header.slot]!;
  const body = slots.filter((s) => s.section === 'body');
  if (body.length > 0 && body.every((s) => s.slot in values)) {
    out.body = body.map((s) => values[s.slot]!);
  }
  const buttons = slots.filter((s) => s.section === 'button' && s.slot in values);
  if (buttons.length > 0) {
    const byIndex = new Map((vars.buttons ?? []).map((b) => [b.index, b]));
    for (const s of buttons) {
      byIndex.set(s.position, { index: s.position, subType: 'url', value: values[s.slot]! });
    }
    out.buttons = [...byIndex.values()].sort((a, b) => a.index - b.index);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ schedule

/** The classic campaign columns a wizard schedule maps onto (the sweeper fires on the date, time and zone). */
export function scheduleColumns(
  s: WizardSchedule,
  runAt: Date | null,
): {
  scheduleType: 'now' | 'scheduled';
  sendDate: string | null;
  sendTime: string | null;
  timezone: string;
  runAt: Date | null;
} {
  if (s.mode === 'scheduled') {
    return {
      scheduleType: 'scheduled',
      sendDate: s.date,
      sendTime: s.time,
      timezone: s.timezone,
      runAt,
    };
  }
  return { scheduleType: 'now', sendDate: null, sendTime: null, timezone: 'UTC', runAt };
}

// ------------------------------------------------------------------------------------------------ frequency-cap retries

/**
 * Meta's frequency capping, however the failure reached us: the code on the recipient, or the text the provider and the older paths
 * carry (`131049`, "healthy ecosystem engagement"). The only failure a retry is for.
 */
export function isFrequencyCap(f: { code?: string | null; message?: string | null }): boolean {
  if ((f.code ?? '').trim() === FREQUENCY_CAP_ERROR_CODE) return true;
  const m = (f.message ?? '').toLowerCase();
  return m.includes(FREQUENCY_CAP_ERROR_CODE) || m.includes('healthy ecosystem');
}

/** SQL fragment form of the same rule, for the retry job's scans (columns of wp_campaign_contacts, alias `r`). */
export const FREQUENCY_CAP_SQL = `(r.error_code = '${FREQUENCY_CAP_ERROR_CODE}' OR r.error_message ILIKE '%${FREQUENCY_CAP_ERROR_CODE}%' OR r.error_message ILIKE '%healthy ecosystem%')`;

/**
 * When the next retry of a recipient is due after a frequency-cap failure. Retry slots sit on a grid anchored at the FIRST send: slot k
 * is exactly k x 24 hours after it, however late a run actually was, so the cadence never drifts. `retriesDone` is the last slot
 * used. The slot returned is the first one still in the future of `now`: if the worker was down and a retry ran late, the slots it
 * missed are skipped, so retries are never bunched together or closer than the grid allows. Null when the slot falls at or after the
 * moment the retry window closes.
 */
export function nextRetrySlot(o: {
  firstSentAt: Date;
  retriesDone: number;
  now: Date;
  windowCloses: Date | null;
}): { at: Date | null; attemptNo: number } {
  const step = WIZARD_RETRY_INTERVAL_HOURS * 3_600_000;
  let attemptNo = o.retriesDone + 1;
  let at = o.firstSentAt.getTime() + attemptNo * step;
  while (at <= o.now.getTime() && attemptNo < 10_000) {
    attemptNo++;
    at = o.firstSentAt.getTime() + attemptNo * step;
  }
  if (o.windowCloses && at >= o.windowCloses.getTime()) return { at: null, attemptNo };
  return { at: new Date(at), attemptNo };
}

// ------------------------------------------------------------------------------------------------ cost

export interface CostLine {
  country: string | null;
  messages: number;
  unitPriceMinor: number;
}

/**
 * What the wallet is expected to be charged: every destination's messages at its price; when the plan's monthly allowance covers part
 * of the send (plan mode), only the chargeable share of it, rounded up so the estimate never under-promises.
 */
export function estimateCost(
  lines: readonly CostLine[],
  chargeable: number,
): { subtotals: number[]; totalMinor: number } {
  const messages = lines.reduce((n, l) => n + l.messages, 0);
  const share = messages === 0 ? 0 : Math.min(1, chargeable / messages);
  const subtotals = lines.map((l) => Math.ceil(l.messages * l.unitPriceMinor * share));
  return { subtotals, totalMinor: subtotals.reduce((n, v) => n + v, 0) };
}

/** Phone states at Meta that stop a number from carrying a guided campaign. */
const BLOCKED_PHONE_STATUS = new Set(['BANNED', 'RESTRICTED', 'DELETED', 'MIGRATED', 'PENDING']);

/**
 * Whether the guided (four-step) flow may send from a number: a Meta (`waba`) number that is connected and verified. What Meta
 * reported at connect and in the health checks (`meta_json`) is read when present; a field that is not there blocks nothing, since
 * only a number that passed the connect checks is `connected` at all.
 */
export function senderGuided(o: {
  engine: string;
  status: string | null;
  meta: Record<string, unknown> | null;
}): boolean {
  if (o.engine !== 'waba' || o.status !== 'connected') return false;
  const m = o.meta ?? {};
  const up = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : '');
  // Meta keeps `code_verification_status` at NOT_VERIFIED for numbers that never went through the SMS/voice code step (its own test number,
  // numbers added by embedded signup), and those send fine once `phone_status` is CONNECTED: that field decides. EXPIRED always blocks.
  const code = up(m.code_verification_status);
  if (code === 'EXPIRED') return false;
  if (code === 'NOT_VERIFIED' && up(m.phone_status) !== 'CONNECTED') return false;
  if (['DECLINED'].includes(up(m.name_status))) return false;
  if (BLOCKED_PHONE_STATUS.has(up(m.phone_status))) return false;
  return true;
}

/** Messages the wallet pays for: all of them in wallet mode; beyond the plan's remaining allowance in plan mode (a limit of 0 is unlimited). */
export function chargeableMessages(o: {
  mode: 'plan' | 'wallet';
  recipients: number;
  monthlyLimit: number;
  usedThisMonth: number;
  planActive: boolean;
}): number {
  if (o.mode === 'wallet' || !o.planActive) return o.recipients;
  if (o.monthlyLimit <= 0) return 0;
  return Math.max(0, Math.min(o.recipients, o.usedThisMonth + o.recipients - o.monthlyLimit));
}
