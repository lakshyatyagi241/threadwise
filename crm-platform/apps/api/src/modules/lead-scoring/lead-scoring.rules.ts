import { LSC_MODELS } from '@crm/contracts';

/** Pure rules of AI lead scoring: what is sent, how the answer is read, what a call cost. No I/O. */

export const AI_PROVIDER = 'openrouter';
/** Enough for the JSON answer plus a low-effort reasoning pass. */
export const MAX_COMPLETION_TOKENS = 900;

/**
 * What the model sees about a contact. Deliberately NOT the person's name, email address, phone number or free-text message: a score
 * needs the shape of the relationship, not who it is with, so the vendor gets no direct identifier.
 */
export interface ScoringFacts {
  stage: string;
  status: string | null;
  source: string | null;
  channel: string | null;
  title: string | null;
  language: string | null;
  country: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  emailKind: 'business' | 'free' | null;
  emailConfirmed: boolean;
  unsubscribed: boolean;
  company: string | null;
  tags: string[];
  /** Custom property values, capped (see `customFacts`). */
  properties: Record<string, string | number | boolean>;
  daysSinceCreated: number;
  daysSinceActivity: number | null;
  dealsOpen: number;
  dealsWon: number;
  dealsLost: number;
  /** Open pipeline in the deals' own currency units (minor units / 100), summed across currencies: a hint, not an accounting figure. */
  openDealValue: number;
  /** Days since the contact entered its current lifecycle stage (since it was created when no stage date was ever stamped). */
  daysInStage: number;
  /** Engagement signals: counts and durations from broadcasts, link clicks and the chat. */
  engagement: EngagementFacts;
  /** Coarse facts about the contact's company from the growth pilot's enrichment; absent for every workspace without it. */
  enrichment?: { companySize?: string; industry?: string; seniority?: string; country?: string };
}

/**
 * How the contact has behaved lately, as numbers only: no message text, no template text, no link, no identifier. That is why adding
 * them does not change what the workspace agreed to send to the vendor.
 */
export interface EngagementFacts {
  /** Broadcast messages that reached the provider in the last 30 days. */
  broadcastsReceived30d: number;
  /** Of those, how many the contact opened (read receipt). */
  broadcastsRead30d: number;
  /** Tracked links the contact clicked in the last 30 days (distinct links, not clicks). */
  linksClicked30d: number;
  /** Messages the contact itself sent in the last 7 days (no bots, no staff, no imported history). */
  messagesFromContact7d: number;
  /** Hours since the contact last wrote to us on any thread; null when it never has. */
  hoursSinceLastInbound: number | null;
  /** Average minutes the contact took to answer something we sent, over the last 30 days; null when it never answered. */
  avgReplyMinutes30d: number | null;
}

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
]);

export const emailKind = (email: string | null): 'business' | 'free' | null => {
  const at = email?.lastIndexOf('@') ?? -1;
  if (!email || at < 0) return null;
  return FREE_MAIL.has(
    email
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  )
    ? 'free'
    : 'business';
};

const MAX_PROPERTIES = 15;
const MAX_VALUE_LENGTH = 80;

/** The contact's custom properties as plain facts: scalars only, trimmed, at most a handful (a form can hold hundreds). */
export function customFacts(data: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPERTIES) break;
    if (typeof value === 'string' && value.trim()) {
      out[key.slice(0, 60)] = value.trim().slice(0, MAX_VALUE_LENGTH);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key.slice(0, 60)] = value;
    } else if (typeof value === 'boolean') {
      out[key.slice(0, 60)] = value;
    }
  }
  return out;
}

export const SYSTEM_PROMPT = [
  'You are a lead scoring engine for a CRM. You rate how likely a contact is to become a paying customer, from 0 (no chance) to 100 (ready to buy).',
  'Use only the facts you are given; they are anonymised on purpose. Do not guess who the person is.',
  'Guidance: a won deal, an open deal with value, recent activity, a business email, a known company and a confirmed channel raise the score;',
  'an unsubscribed contact, a lost deal with nothing open, a long silence, or almost no information lower it. A contact with almost no facts is low, not zero.',
  'The "engagement" object is behaviour: messages the contact sent lately, a short time since its last message, quick replies, broadcasts it opened and links it clicked are strong positive signals,',
  'and broadcasts received but never opened, or a long time since its last message, are weak negative ones. Zeros there mean no recorded contact, not a bad contact; weigh them lightly when the rest of the facts are strong.',
  'Answer with one JSON object and nothing else: {"score": <integer 0-100>, "reasons": [<up to 4 short strings, each under 120 characters, the strongest signals first>]}.',
].join(' ');

/** Said to the model only when it is given enrichment, so the prompt of every other workspace is unchanged. */
export const ENRICHMENT_NOTE =
  'The "enrichment" object describes the contact\u2019s company (size band, industry) and seniority: a larger company and a senior role raise the score a little; they never outweigh the contact\u2019s own behaviour.';

export function scoringPrompt(facts: ScoringFacts): { system: string; user: string } {
  return {
    system: facts.enrichment ? `${SYSTEM_PROMPT} ${ENRICHMENT_NOTE}` : SYSTEM_PROMPT,
    user: `Contact facts:\n${JSON.stringify(facts)}`,
  };
}

export interface ParsedScore {
  score: number;
  reasons: string[];
}

/** The JSON object in a model's answer: plain, in a code fence, or inside chatter. Null when there is none. */
export function extractJsonObject(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1]!.trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Reads the model's answer. Tolerates a code fence around the JSON and a score given as a string or a decimal; refuses anything that
 * is not a finite number, because writing a guessed score into a CRM is worse than writing none. The score is rounded and clamped.
 */
export function parseScore(text: string): ParsedScore | null {
  const json = extractJsonObject(text);
  if (!json || typeof json !== 'object') return null;
  const raw = (json as { score?: unknown }).score;
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const reasonsRaw = (json as { reasons?: unknown }).reasons;
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.trim().slice(0, 160))
        .filter((r) => r.length > 0)
        .slice(0, 4)
    : [];
  return { score: Math.max(0, Math.min(100, Math.round(n))), reasons };
}

/** USD for a call from the price list: tokens x USD per million. Null for a model that is not on the list. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const m = LSC_MODELS.find((x) => x.id === model);
  if (!m) return null;
  return (promptTokens * m.inputPerMillion + completionTokens * m.outputPerMillion) / 1_000_000;
}

/** The figure the log keeps: the vendor's own when it reported one, else the estimate, else nothing. */
export function resolveCost(
  vendorUsd: number | null,
  model: string,
  promptTokens: number,
  completionTokens: number,
): { costUsd: number; source: 'vendor' | 'estimate' | 'none' } {
  if (vendorUsd !== null) return { costUsd: vendorUsd, source: 'vendor' };
  const est = estimateCostUsd(model, promptTokens, completionTokens);
  return est === null ? { costUsd: 0, source: 'none' } : { costUsd: est, source: 'estimate' };
}

/** A USD amount as the ledger's decimal string (eight decimals: one score costs a few thousandths of a cent). */
export const usdString = (n: number): string => (Number.isFinite(n) && n > 0 ? n : 0).toFixed(8);

/** Whether a contact's score may be written by the scorer: empty, or one the scorer wrote itself. */
export const scorerMayWrite = (c: {
  leadScore: number | null;
  leadScoreSource: string | null;
}): boolean => c.leadScore === null || c.leadScoreSource === 'ai';

/** Opaque keyset cursor over (created_at, id), newest first. */
export const encodeRunCursor = (createdAt: Date, id: number): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

export function decodeRunCursor(cursor: string): { at: Date; id: number } | null {
  const [atRaw, idRaw] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(atRaw ?? '');
  const id = Number(idRaw);
  return Number.isNaN(at.getTime()) || !Number.isInteger(id) ? null : { at, id };
}
