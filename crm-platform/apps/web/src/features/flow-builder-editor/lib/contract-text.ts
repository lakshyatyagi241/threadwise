import {
  FLB_COND_OP_SYMBOLS,
  FLB_NODE_TYPES,
  FLB_TRIGGER_PORT_LABELS,
  flbCleanDateFormat,
  flbIsCondGroup,
  flbListOption,
  type FlbAskInputType,
  type FlbCondGroup,
  type FlbCondRule,
  type FlbPortDef,
  type FlowType,
} from '@crm/contracts';
import { msg, type Msg, type Translate } from './msg';

/**
 * The words @crm/contracts ships in English (node names and descriptions, groups, input kinds, port labels, the condition
 * one-liner) looked up by their stable id in the `flb.contracts.*` messages. The contracts keep their English: the API reads
 * the same values. Each lookup falls back to the contract's own text when the web catalogue has no entry for an id (a node
 * type added to the contracts before its translation).
 */

const has = (t: Translate, key: string): boolean => (t.has ? t.has(key) : true);

/** `Call routing` -> `callRouting`: the key of a node group. */
export const groupKey = (group: string): string =>
  group.toLowerCase().replace(/ (\w)/g, (_, c: string) => c.toUpperCase());

/** `dd/mm/yyyy` -> `ddSmmSyyyy`: a date shape as a message key (a key cannot hold `-`, `/` or `.`). */
export const dateFormatKey = (f: string): string =>
  f.replace(/-/g, 'D').replace(/\//g, 'S').replace(/\./g, 'P');

export function nodeLabel(t: Translate, type: string): string {
  const key = `contracts.nodeTypes.${type}.label`;
  return has(t, key) ? t(key) : (FLB_NODE_TYPES[type]?.label ?? type);
}

export function nodeDescription(t: Translate, type: string): string {
  const key = `contracts.nodeTypes.${type}.description`;
  return has(t, key) ? t(key) : (FLB_NODE_TYPES[type]?.desc ?? '');
}

export function groupLabel(t: Translate, group: string): string {
  const key = `contracts.groups.${groupKey(group)}`;
  return has(t, key) ? t(key) : group;
}

export const nodeLabelMsg = (type: string): Msg =>
  msg(`contracts.nodeTypes.${type}.label`, undefined, FLB_NODE_TYPES[type]?.label ?? type);

export const askInputLabel = (t: Translate, type: FlbAskInputType): string =>
  t(`contracts.askInput.${type}`);

export const askInputLabelMsg = (type: FlbAskInputType): Msg => msg(`contracts.askInput.${type}`);

/** The text sent when an answer does not pass and the author wrote none. */
export function askInputWrongText(
  t: Translate,
  type: FlbAskInputType,
  dateFormat?: unknown,
): string {
  return t(`contracts.askInputWrong.${type}`, {
    format: flbCleanDateFormat(dateFormat).toUpperCase(),
  });
}

export const askFileGroupLabel = (t: Translate, id: string, fallback: string): string => {
  // The Allow Extensions checklist already has these names.
  const key = `builder.askMedia.extensions.group.${id}`;
  return has(t, key) ? t(key) : fallback;
};

export const flowTypeLabel = (t: Translate, type: FlowType): string =>
  t(`contracts.flowTypes.${type}`);

export const dateFormatLabel = (t: Translate, f: string): string =>
  t(`contracts.dateFormats.${dateFormatKey(f)}`);

// --- ports ------------------------------------------------------------------------------------------------------------

/** The fixed English labels `flbPortsFor` gives a port, by the message that stands for each. */
const PORT_KEYS: Record<string, string> = {
  next: 'next',
  sent: 'sent',
  'link sent': 'linkSent',
  'reply received': 'replyReceived',
  'else / no match': 'elseNoMatch',
  'file received': 'fileReceived',
  'location received': 'locationReceived',
  'IF · true': 'ifTrue',
  'ELSE · false': 'elseFalse',
  'after wait': 'afterWait',
  response: 'response',
  done: 'done',
  rows: 'rows',
  'reply ready': 'replyReady',
  'after run': 'afterRun',
  spoken: 'spoken',
  heard: 'heard',
  answered: 'answered',
  results: 'results',
  'if no answer': 'ifNoAnswer',
  'no match': 'noMatch',
  replied: 'replied',
  saved: 'saved',
  'handed off': 'handedOff',
  'after paid': 'afterPaid',
  'invoice sent': 'invoiceSent',
  purchased: 'purchased',
  abandoned: 'abandoned',
  booked: 'booked',
  'no slots': 'noSlots',
  'call placed': 'callPlaced',
  'row loaded': 'rowLoaded',
  'row written': 'rowWritten',
  'doc sent': 'docSent',
  submitted: 'submitted',
  'timed out': 'timedOut',
  moved: 'moved',
  created: 'created',
  error: 'error',
  assigned: 'assigned',
  'waiting in queue': 'waitingInQueue',
  'no agent / out of hours': 'noAgentOutOfHours',
  'returned to the bot': 'returnedToBot',
};
/** What a branch port shows when the author has not named its button / answer / option / row yet. */
const NUMBERED = /^(Button|Answer|Option|Item) (\d+)$/;
const PLACEHOLDERS: Record<string, string> = {
  Option: 'optionPlaceholder',
  Item: 'itemPlaceholder',
  option: 'optionLower',
};

/**
 * The label under one output port of a node card. The branch ports of a buttons / list / ask / menu node carry the author's
 * own words (kept as written); only the fallbacks the contracts invent for an unnamed one (`Button 2`) and the fixed labels
 * of the other ports (`reply received`, `IF · true`) go through the catalogue.
 */
export function portLabel(
  t: Translate,
  node: { type: string; data?: Record<string, unknown> | null },
  port: Pick<FlbPortDef, 'id' | 'label'>,
): string {
  if (node.type === 'trigger') {
    const kind = String(node.data?.kind ?? '');
    if (FLB_TRIGGER_PORT_LABELS[kind]) return t(`contracts.triggerPorts.${kind}`);
    return kind || t('contracts.ports.manual');
  }
  if (/^p\d+$/.test(port.id)) {
    const n = NUMBERED.exec(port.label);
    if (n) return t(`contracts.ports.${n[1]!.toLowerCase()}`, { n: Number(n[2]) });
    const ph = PLACEHOLDERS[port.label];
    return ph ? t(`contracts.ports.${ph}`) : port.label;
  }
  const key = PORT_KEYS[port.label];
  return key ? t(`contracts.ports.${key}`) : port.label;
}

// --- conditions -------------------------------------------------------------------------------------------------------

/** `flbCondSummary` with its words (AND, OR, is set) from the catalogue: `({{a}} = x AND {{b}} > 3) OR {{c}} is set`. */
export function condSummary(t: Translate, g: FlbCondGroup): string {
  const rule = (r: FlbCondRule) => {
    const op = r.operator || 'equals';
    const sym =
      op === 'exists' ? t('contracts.cond.isSet') : (FLB_COND_OP_SYMBOLS[op] ?? r.operator);
    const left = `{{${r.variable.trim() || '?'}}} ${sym}`;
    return r.operator === 'exists' ? left : `${left} ${r.value.trim() || '?'}`;
  };
  const group = (grp: FlbCondGroup, root: boolean): string => {
    if (grp.items.length === 0) return '()';
    const body = grp.items
      .map((i) => (flbIsCondGroup(i) ? group(i, false) : rule(i)))
      .join(` ${t(grp.op === 'or' ? 'contracts.cond.or' : 'contracts.cond.and')} `);
    return !root && grp.items.length > 1 ? `(${body})` : body;
  };
  return group(g, true);
}

/** `flbListOption` with the name of an untitled row ("Item 2") from the catalogue. */
export function listOption(t: Translate, o: unknown, i: number) {
  const r = flbListOption(o, i);
  const titled =
    typeof o === 'string' || String((o as { title?: unknown } | null)?.title ?? '') !== '';
  return titled ? r : { ...r, title: t('contracts.ports.item', { n: i + 1 }) };
}
