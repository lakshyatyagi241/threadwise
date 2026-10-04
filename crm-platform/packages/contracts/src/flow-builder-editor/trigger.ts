import { FLB_TRIGGER_KINDS, type FlbTriggerKind } from './node-catalogue';
import type { FlowGraph } from './graph';

/**
 * Trigger column extraction (WD-FLB-020): the first Trigger node, read into the plain columns enrolment and the inbound
 * matcher query without opening the graph. Pure: the references it returns are still the wire's (uuids), and the API
 * resolves them to internal ids inside the save transaction.
 *
 * Differences from WaDesk, all deliberate: a tag, group, stage or sender is a uuid on this platform, never a numeric
 * database id, so `valueRef` / `senderRef` carry the uuid and the service looks the row up (a value that does not resolve
 * stores null, as WaDesk stored null for a non-numeric id).
 */

/** The engine prefix of a sender key (`waba:<id>`). `baileys` is the real key; "unofficial" is only a UI label. */
export const FLB_SENDER_ENGINES = [
  'baileys',
  'waba',
  'twilio',
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
  'line',
  'wechat',
  'viber',
  'email',
] as const;
export type FlbSenderEngine = (typeof FLB_SENDER_ENGINES)[number];

export type FlbTriggerValueKind = 'tag' | 'group' | 'stage' | 'zero' | 'none';

export interface FlbTriggerExtract {
  kind: FlbTriggerKind;
  /** What `trigger_value` holds: a tag / group / stage lookup, the literal 0, or nothing. */
  valueKind: FlbTriggerValueKind;
  valueRef: string | null;
  /** `any` for the catch-all, the trimmed keyword text, a comma list of rule ids (comment_to_dm), or null. */
  keywords: string | null;
  engine: FlbSenderEngine | null;
  /** The part after `engine:`; a bare value (legacy flows) has no engine. */
  senderRef: string | null;
  /** True when no Trigger node exists: WaDesk saves `keyword` with no keywords and the flow never fires. */
  hasTrigger: boolean;
}

const isKind = (v: unknown): v is FlbTriggerKind =>
  (FLB_TRIGGER_KINDS as readonly string[]).includes(v as string);
const isEngine = (v: string): v is FlbSenderEngine =>
  (FLB_SENDER_ENGINES as readonly string[]).includes(v);

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

export function flbExtractTrigger(graph: Pick<FlowGraph, 'flowNodes'>): FlbTriggerExtract {
  const node = graph.flowNodes.find((n) => n.type === 'trigger');
  if (!node) {
    return {
      kind: 'keyword',
      valueKind: 'none',
      valueRef: null,
      keywords: null,
      engine: null,
      senderRef: null,
      hasTrigger: false,
    };
  }
  const d = node.data;
  const kind: FlbTriggerKind = isKind(d.kind) ? d.kind : 'keyword';

  let valueKind: FlbTriggerValueKind = 'none';
  let valueRef: string | null = null;
  switch (kind) {
    case 'tag_added':
      valueKind = 'tag';
      valueRef = text(d.tagId) || null;
      break;
    case 'group_join':
      valueKind = 'group';
      valueRef = text(d.groupId) || null;
      break;
    case 'deal_stage_changed':
      valueKind = 'stage';
      valueRef = text(d.stageId) || null;
      break;
    case 'contact_created':
    case 'opt_in':
    case 'order_placed':
    case 'away':
    case 'out_of_hours':
    case 'comment_to_dm':
      valueKind = 'zero';
      break;
    default:
      break;
  }

  const raw = text(d.deviceId);
  let engine: FlbSenderEngine | null = null;
  let senderRef: string | null = null;
  if (raw) {
    const i = raw.indexOf(':');
    if (i > 0) {
      const e = raw.slice(0, i).toLowerCase();
      if (isEngine(e)) {
        engine = e;
        senderRef = raw.slice(i + 1) || null;
      }
    } else {
      senderRef = raw;
    }
  }

  let keywords: string | null = null;
  if (kind === 'keyword') {
    const mode = text(d.keywordMode ?? d.triggerMode);
    if (mode === 'any') keywords = 'any';
    else keywords = text(d.keywords) || null;
  } else if (kind === 'comment_to_dm') {
    const ids = Array.isArray(d.keywordRuleIds) ? d.keywordRuleIds.map(text).filter(Boolean) : [];
    keywords = ids.length ? ids.join(',') : null;
  }

  return { kind, valueKind, valueRef, keywords, engine, senderRef, hasTrigger: true };
}

/** `keyword_replies.keyword` was VARCHAR(255) in WaDesk; the limit stays so a trigger that long is still refused. */
export const FLB_TRIGGER_KEYWORDS_MAX = 255;

export function flbTriggerKeywordsTooLong(keywords: string | null): string | null {
  if (keywords === null) return null;
  // WaDesk counted characters (mb_strlen), not UTF-16 units: an emoji is one.
  const length = Array.from(keywords).length;
  if (length <= FLB_TRIGGER_KEYWORDS_MAX || flbIsCatchAllKeywords(keywords)) return null;
  return `Trigger keyword is too long (${length} characters; the limit is ${FLB_TRIGGER_KEYWORDS_MAX}). Open the flow's Trigger node and shorten the keywords — remove duplicates or extra phrases.`;
}

/**
 * The catch-all spellings (`*`, `.*`, `.+`, `any`) of a keyword trigger (WD-FLB-021). Compared exactly after trimming, as
 * WaDesk's sync and the runtime matcher (FLR `isCatchAll`) do: `ANY` typed by hand is an ordinary keyword.
 */
export const flbIsCatchAllKeywords = (keywords: string | null): boolean =>
  keywords !== null && ['*', '.*', '.+', 'any'].includes(keywords.trim());
