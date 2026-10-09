import { flbListOption, type FlowType } from '@crm/contracts';

/**
 * A `useTranslations('flb.builder.formsCore.helpers')` function. The helpers below return text, so the component hands its
 * translator in (a helper outside a component cannot call the hook).
 */
export type HelperT = (key: string, values?: Record<string, string | number>) => string;

/** Pure helpers behind the core node forms (kept out of the components so they can be unit tested). */

export const LIST_TITLE_MAX = 24;
export const LIST_DESC_MAX = 72;
export const LIST_SECTION_MAX = 24;
export const CTA_MAX_ACTIONS = 3;

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Swaps item `i` with its neighbour in `dir`; returns the same array when the move is out of range. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list.slice();
  const next = list.slice();
  const a = next[i] as T;
  next[i] = next[j] as T;
  next[j] = a;
  return next;
}

/** Patches item `i` of a list, leaving the others untouched. */
export function patchItem<T extends object>(list: readonly T[], i: number, patch: Partial<T>): T[] {
  return list.map((item, j) => (j === i ? { ...item, ...patch } : item));
}

export interface SelectOpt {
  v: string;
  l: string;
}

/** Appends the saved value as a labelled option when it is not among the choices (WaDesk keeps a stale pick visible). */
export function withCurrent(
  opts: SelectOpt[],
  current: unknown,
  label: (v: string) => string,
): SelectOpt[] {
  const v = str(current);
  if (v && !opts.some((o) => o.v === v)) return [...opts, { v, l: label(v) }];
  return opts;
}

/** "<name> · live" / "<name> · draft": the Sub-flow picker marks each flow with its published state (WaDesk). */
export const subflowLabel = (t: HelperT, name: string, isPublished: boolean): string =>
  t(isPublished ? 'subflowLive' : 'subflowDraft', { name: name || t('flowFallback') });

/** "<name> · <provider>/<model>" (the name alone when the provider is unknown): the Chatbot picker's agent label. */
export function agentLabel(
  t: HelperT,
  a: {
    name: string;
    provider?: string | null | undefined;
    model?: string | null | undefined;
  },
): string {
  const name = a.name || t('agentFallback');
  return a.provider && a.model
    ? t('agentWithModel', { name, model: `${a.provider}/${a.model}` })
    : name;
}

// --- trigger -------------------------------------------------------------------------------------------------------

export type SenderChannel =
  'chat' | 'instagram' | 'facebook' | 'tiktok' | 'telegram' | 'line' | 'wechat' | 'viber' | 'email';

const SENDER_CHANNELS: readonly string[] = [
  'chat',
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
  'line',
  'wechat',
  'viber',
  'email',
];

/** The channel a Trigger runs on: the saved one when the workspace offers it, else the flow's own channel. */
export function resolveTriggerChannel(
  saved: unknown,
  channels: readonly FlowType[],
  mode: FlowType,
): SenderChannel {
  const s = str(saved);
  if (s && channels.includes(s as FlowType) && SENDER_CHANNELS.includes(s))
    return s as SenderChannel;
  return SENDER_CHANNELS.includes(mode) ? (mode as SenderChannel) : 'chat';
}

interface SenderLike {
  key: string;
  label: string;
  engineLabel?: string | null | undefined;
}

export function senderOptions(
  t: HelperT,
  channel: SenderChannel,
  senders: readonly SenderLike[],
): SelectOpt[] {
  return [
    { v: '', l: senders.length ? t(`senderPick.${channel}`) : t(`senderEmpty.${channel}`) },
    ...senders.map((s) => ({
      v: s.key,
      l:
        channel === 'chat' && s.engineLabel && !s.label.includes(s.engineLabel)
          ? t('senderEngine', { label: s.label, engine: s.engineLabel })
          : s.label,
    })),
  ];
}

/** A translated sentence that ends in (or holds) a link: `key` is a rich message with a `<link/>` tag, `href` the path. */
export interface LinkedCopy {
  key: string;
  href: string;
}

/** The field label above the sender select ("Listen on ..." for keyword flows, "Send from ..." otherwise). */
export function senderLabel(t: HelperT, channel: SenderChannel, kind: unknown): string {
  return t(`senderLabel.${kind === 'keyword' ? 'listen' : 'send'}.${channel}`);
}

export function senderHint(channel: SenderChannel, unofficial = false): LinkedCopy {
  switch (channel) {
    case 'instagram':
      return { key: 'senderHint.instagram', href: '/instagram' };
    case 'facebook':
      return { key: 'senderHint.facebook', href: '/facebook' };
    case 'telegram':
      return { key: 'senderHint.telegram', href: '/telegram' };
    case 'line':
      return { key: 'senderHint.line', href: '/settings/channels' };
    case 'wechat':
      return { key: 'senderHint.wechat', href: '/settings/channels' };
    case 'viber':
      return { key: 'senderHint.viber', href: '/settings/channels' };
    case 'email':
      return { key: 'senderHint.email', href: '/settings/channels' };
    default:
      // Only the official WhatsApp Business API (and Twilio) are offered unless the platform has switched the unofficial engine on.
      return unofficial
        ? { key: 'senderHint.chatUnofficial', href: '/devices' }
        : { key: 'senderHint.chatOfficial', href: '/channels/whatsapp' };
  }
}

/** The key of WaDesk's red "Pick an Instagram account before saving ..." note for a channel. */
export function senderPickKey(channel: SenderChannel): string {
  if (channel === 'instagram' || channel === 'facebook' || channel === 'email') {
    return `senderPickNotice.${channel}`;
  }
  return channel === 'telegram' ? 'senderPickNotice.telegram' : 'senderPickNotice.number';
}

export function senderNoneCopy(channel: SenderChannel, unofficial = false): LinkedCopy {
  switch (channel) {
    case 'instagram':
      return { key: 'senderNone.instagram', href: '/instagram' };
    case 'facebook':
      return { key: 'senderNone.facebook', href: '/facebook' };
    case 'telegram':
      return { key: 'senderNone.telegram', href: '/telegram' };
    case 'email':
      return { key: 'senderNone.email', href: '/settings/channels' };
    default:
      return {
        key: 'senderNone.number',
        href: unofficial ? '/devices' : '/channels/whatsapp',
      };
  }
}

/** Toggles a rule id in the comment-to-DM binding (ids are stored as strings). */
export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

// --- list ----------------------------------------------------------------------------------------------------------

export interface ListItem {
  title: string;
  description: string;
  section: string;
}

export function listItems(options: unknown): ListItem[] {
  return asArray(options).map((o, i) => flbListOption(o, i));
}

export interface SectionGroup<T> {
  title: string;
  rows: T[];
}

/** Groups items under their section heading in first-seen order, the way the runtime builds WhatsApp's bottom sheet. */
export function groupBySection<T extends { section: string }>(
  items: readonly T[],
): SectionGroup<T>[] {
  const groups: SectionGroup<T>[] = [];
  for (const o of items) {
    const title = o.section.trim();
    const g = groups.find((x) => x.title === title);
    if (g) g.rows.push(o);
    else groups.push({ title, rows: [o] });
  }
  return groups;
}

// --- condition -----------------------------------------------------------------------------------------------------

export interface ConditionRow {
  variable?: string;
  operator?: string;
  value?: string;
}

/** Drops row `i` and the AND/OR joiner before it (or the first joiner when the first row goes). */
export function removeConditionRow(
  conds: readonly ConditionRow[],
  ops: readonly string[],
  i: number,
): { conditions: ConditionRow[]; operators: string[] } {
  const operators = ops.slice();
  if (i > 0 && operators.length >= i) operators.splice(i - 1, 1);
  else if (operators.length) operators.splice(0, 1);
  return { conditions: conds.filter((_, j) => j !== i), operators };
}

/** Appends an empty rule; every rule after the first needs a joiner, which starts as AND. */
export function addConditionRow(
  conds: readonly ConditionRow[],
  ops: readonly string[],
): { conditions: ConditionRow[]; operators: string[] } {
  return {
    conditions: [...conds, { variable: '', operator: 'equals', value: '' }],
    operators: conds.length >= 1 ? [...ops, 'AND'] : ops.slice(),
  };
}

// --- cta -----------------------------------------------------------------------------------------------------------

export interface CtaAction {
  type?: string;
  label?: string;
  value?: string;
}

/** Reads the CTA actions, upgrading the legacy single-kind shape (kind/label/url|phone|code) like WaDesk does. */
export function ctaActions(d: Record<string, unknown>): CtaAction[] {
  if (Array.isArray(d.actions)) return d.actions as CtaAction[];
  const k = str(d.kind) || 'url';
  const v =
    k === 'phone' || k === 'call_now' ? str(d.phone) : k === 'copy' ? str(d.code) : str(d.url);
  return [{ type: k, label: str(d.label) || 'CTA', value: v }];
}

export function suggestedCtaLabel(t: HelperT, type: string): string {
  return t(
    `ctaLabel.${type === 'url' || type === 'phone' || type === 'call_now' || type === 'copy' ? type : 'other'}`,
  );
}

export function ctaPlaceholder(type: string): string {
  if (type === 'phone' || type === 'call_now') return '+1 555 123 4567';
  if (type === 'copy') return 'SAVE20';
  return 'https://example.com';
}

/** Changing an action's type keeps a custom label but replaces the old suggested one; the value always resets. */
export function changeCtaType(t: HelperT, cur: CtaAction, newType: string): CtaAction {
  const prevSuggested = suggestedCtaLabel(t, cur.type || 'url');
  const label =
    !cur.label || cur.label === prevSuggested ? suggestedCtaLabel(t, newType) : cur.label;
  return { ...cur, type: newType, label, value: '' };
}

/** The accept filter of the file picker for a media kind. */
export function acceptFor(kind: string, documentAccept = '.pdf,.doc,.docx,.xls,.xlsx'): string {
  if (kind === 'video') return 'video/*';
  if (kind === 'audio') return 'audio/*';
  if (kind === 'document') return documentAccept;
  return 'image/*';
}
