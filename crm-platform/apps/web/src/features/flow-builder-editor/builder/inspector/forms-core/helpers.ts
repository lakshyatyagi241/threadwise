import { flbListOption, type FlowType } from '@crm/contracts';

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
export const subflowLabel = (name: string, isPublished: boolean): string =>
  `${name || 'Flow'}${isPublished ? ' · live' : ' · draft'}`;

/** "<name> · <provider>/<model>" (the model alone when the provider is unknown): the Chatbot picker's agent label. */
export function agentLabel(a: {
  name: string;
  provider?: string | null | undefined;
  model?: string | null | undefined;
}): string {
  const tag = a.provider && a.model ? ` · ${a.provider}/${a.model}` : '';
  return `${a.name || 'Agent'}${tag}`;
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

const SENDER_PLACEHOLDER: Record<SenderChannel, { pick: string; none: string }> = {
  chat: { pick: '— pick number —', none: 'No connected number' },
  instagram: { pick: '— pick Instagram account —', none: 'No connected Instagram account' },
  facebook: { pick: '— pick Facebook Page —', none: 'No connected Facebook Page' },
  tiktok: { pick: '— pick TikTok account —', none: 'No connected TikTok account' },
  telegram: { pick: '— pick Telegram bot —', none: 'No connected Telegram bot' },
  line: { pick: '— pick LINE channel —', none: 'No connected LINE channel' },
  wechat: { pick: '— pick WeChat account —', none: 'No connected WeChat account' },
  viber: { pick: '— pick Viber account —', none: 'No connected Viber account' },
  email: { pick: '— pick mailbox —', none: 'No linked mailbox' },
};

export function senderOptions(channel: SenderChannel, senders: readonly SenderLike[]): SelectOpt[] {
  const ph = SENDER_PLACEHOLDER[channel];
  return [
    { v: '', l: senders.length ? ph.pick : ph.none },
    ...senders.map((s) => ({
      v: s.key,
      l:
        channel === 'chat' && s.engineLabel && !s.label.includes(s.engineLabel)
          ? `${s.label} · ${s.engineLabel}`
          : s.label,
    })),
  ];
}

export interface LinkedCopy {
  before: string;
  href: string;
  after: string;
}

/** The field label above the sender select ("Listen on ..." for keyword flows, "Send from ..." otherwise). */
export function senderLabel(channel: SenderChannel, kind: unknown): string {
  const listen = kind === 'keyword';
  const noun: Record<SenderChannel, string> = {
    instagram: 'Instagram account',
    facebook: 'Facebook Page',
    line: 'LINE channel',
    wechat: 'WeChat account',
    viber: 'Viber account',
    email: 'mailbox',
    // WaDesk has no dedicated copy for these two and falls back to the WhatsApp wording.
    chat: 'number',
    tiktok: 'number',
    telegram: 'Telegram bot',
  };
  return `${listen ? 'Listen on' : 'Send from'} ${noun[channel]}`;
}

export function senderHint(channel: SenderChannel, unofficial = false): LinkedCopy {
  switch (channel) {
    case 'instagram':
      return {
        before: 'Required — which connected Instagram account this flow runs on. Connect one on ',
        href: '/instagram',
        after: '.',
      };
    case 'facebook':
      return {
        before: 'Required — which connected Facebook Page this flow runs on. Connect one on ',
        href: '/facebook',
        after: '.',
      };
    case 'telegram':
      return {
        before: 'Required — which connected Telegram bot this flow runs on. Connect one on ',
        href: '/telegram',
        after: '.',
      };
    case 'line':
      return {
        before: 'Required — which connected LINE channel this flow runs on. Connect one on ',
        href: '/settings/channels',
        after: '.',
      };
    case 'wechat':
      return {
        before: 'Required — which connected WeChat account this flow runs on. Connect one on ',
        href: '/settings/channels',
        after: '.',
      };
    case 'viber':
      return {
        before: 'Required — which connected Viber account this flow runs on. Connect one on ',
        href: '/settings/channels',
        after: '.',
      };
    case 'email':
      return {
        before:
          'Required — which linked mailbox this flow runs on. Replies are sent from that address. Link one on ',
        href: '/settings/channels',
        after: '.',
      };
    default:
      // Only the official WhatsApp Business API (and Twilio) are offered unless the platform has switched the unofficial engine on.
      return unofficial
        ? {
            before:
              'Required — which connected number this flow runs on, across all your engines (Unofficial / WABA / Twilio). Connect one on ',
            href: '/devices',
            after: '.',
          }
        : {
            before:
              'Required — which connected number this flow runs on, across your official engines (WhatsApp Business API / Twilio). Connect one on ',
            href: '/channels/whatsapp',
            after: '.',
          };
  }
}

/** "Pick an Instagram account before saving ..." noun phrase (WaDesk's red note). */
export function senderPickNoun(channel: SenderChannel): string {
  if (channel === 'instagram') return 'an Instagram account';
  if (channel === 'facebook') return 'a Facebook Page';
  if (channel === 'email') return 'a mailbox';
  if (channel === 'telegram') return 'a Telegram bot';
  return 'a number';
}

export function senderNoneCopy(channel: SenderChannel, unofficial = false): LinkedCopy {
  switch (channel) {
    case 'instagram':
      return {
        before:
          'No Instagram account is connected to this workspace yet. You can still build and save this flow — connect one on ',
        href: '/instagram',
        after: ' and pick it here before publishing.',
      };
    case 'facebook':
      return {
        before:
          'No Facebook Page is connected to this workspace yet. You can still build and save this flow — connect one on ',
        href: '/facebook',
        after: ' and pick it here before publishing.',
      };
    case 'telegram':
      return {
        before:
          'No Telegram bot is connected to this workspace yet. You can still build and save this flow — connect one on ',
        href: '/telegram',
        after: ' and pick it here before publishing.',
      };
    case 'email':
      return {
        before:
          'No mailbox is linked to this workspace yet. You can still build and save this flow — link one on ',
        href: '/settings/channels',
        after: ' and pick it here before publishing.',
      };
    default:
      return {
        before:
          "No connected number in this workspace yet — a disconnected phone can't send, so it isn't listed. You can still build and save this flow — reconnect on ",
        href: unofficial ? '/devices' : '/channels/whatsapp',
        after: ' and pick it here before publishing.',
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

export function suggestedCtaLabel(type: string): string {
  return (
    (
      { url: 'Visit website', phone: 'Call us', call_now: 'Call now', copy: 'Copy code' } as Record<
        string,
        string
      >
    )[type] ?? 'Tap'
  );
}

export function ctaPlaceholder(type: string): string {
  if (type === 'phone' || type === 'call_now') return '+1 555 123 4567';
  if (type === 'copy') return 'SAVE20';
  return 'https://example.com';
}

/** Changing an action's type keeps a custom label but replaces the old suggested one; the value always resets. */
export function changeCtaType(cur: CtaAction, newType: string): CtaAction {
  const prevSuggested = suggestedCtaLabel(cur.type || 'url');
  const label = !cur.label || cur.label === prevSuggested ? suggestedCtaLabel(newType) : cur.label;
  return { ...cur, type: newType, label, value: '' };
}

/** The accept filter of the file picker for a media kind. */
export function acceptFor(kind: string, documentAccept = '.pdf,.doc,.docx,.xls,.xlsx'): string {
  if (kind === 'video') return 'video/*';
  if (kind === 'audio') return 'audio/*';
  if (kind === 'document') return documentAccept;
  return 'image/*';
}
