import { parseImportConsent, type ConsentProof, type IntakeChannel } from '@crm/contracts';
import type { LeadConsent } from './lead-ingest.port';

/**
 * Consent proof that rides with a lead (BL-168, privacy spec 4.3.2). Pure functions, no database, so every rule is unit tested alone.
 *
 * POLICY: a lead is not consent. A lead that arrives with no proof grants nothing; one whose sender says the person did NOT agree grants
 * nothing; one that says they agreed but names no wording, version, form or ad grants nothing either (a bare "yes" is a label, not proof,
 * the same rule as a subscription status). Only a lead the sender vouches for, with something a person can read later, writes a grant.
 */

const TEXT_MAX = 2000;
const VERSION_MAX = 64;
const ID_MAX = 120;
const CHANNELS = new Set<string>(['whatsapp', 'sms', 'email']);
/** The names read out of the object (or after the `consent_` prefix); any other key is ignored. */
const KNOWN = new Set([
  'given',
  'agreed',
  'accepted',
  'optin',
  'granted',
  'text',
  'wording',
  'notice',
  'version',
  'textversion',
  'noticeversion',
  'at',
  'time',
  'timestamp',
  'date',
  'agreedat',
  'formid',
  'form',
  'adid',
  'ad',
  'channels',
  'channel',
]);

const canonical = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A yes in the words people and tools use (true, 1, yes, accepted, ja, oui, ...). Booleans count; anything else is not a yes. */
export function isYes(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return parseImportConsent(value) === 'granted';
}

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const t = String(value).trim();
  return t === '' ? undefined : t.slice(0, max);
};

/** An ISO time the sender gave, or undefined (an unreadable one is ignored, never a failure). */
function isoOf(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const d = new Date(typeof value === 'number' ? value : value.trim());
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function channelsOf(value: unknown): LeadConsent['channels'] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;|\s]+/)
      : [];
  const out = [
    ...new Set(
      parts.map((p) => String(p).trim().toLowerCase()).filter((p): p is string => CHANNELS.has(p)),
    ),
  ] as NonNullable<LeadConsent['channels']>;
  return out.length > 0 ? out : undefined;
}

/**
 * The consent a generic webhook's body carries. Two shapes, both explicit (a field called `consent` deep inside a payload is never
 * searched for, and no mapping alias guesses):
 *
 *   { "consent": { "given": true, "text": "...", "version": "v2", "at": "2026-10-14T09:00:00Z", "form_id": "...", "ad_id": "...",
 *                  "channels": ["whatsapp", "sms"] } }
 *   { "consent_given": "yes", "consent_text": "...", "consent_version": "...", "consent_at": "...", "consent_form_id": "...", ... }
 *
 * Returns undefined when the body names neither, so a lead without it behaves exactly as before.
 */
export function leadConsentFromBody(body: unknown): LeadConsent | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const top = body as Record<string, unknown>;

  let source: Record<string, unknown> | undefined;
  const nested = Object.entries(top).find(([k]) => canonical(k) === 'consent');
  if (nested && typeof nested[1] === 'object' && nested[1] !== null && !Array.isArray(nested[1])) {
    source = Object.fromEntries(
      Object.entries(nested[1] as Record<string, unknown>).map(([k, v]) => [canonical(k), v]),
    );
  } else {
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(top)) {
      const c = canonical(k);
      const name = c.startsWith('consent') ? c.slice('consent'.length) : '';
      if (KNOWN.has(name)) flat[name] = v;
    }
    if (Object.keys(flat).length > 0) source = flat;
  }
  if (!source) return undefined;

  const pick = (...names: string[]): unknown => {
    for (const n of names) if (source![n] !== undefined && source![n] !== null) return source![n];
    return undefined;
  };
  const given = isYes(pick('given', 'agreed', 'accepted', 'optin', 'granted'));
  const consent: LeadConsent = { given };
  const text = clip(pick('text', 'wording', 'notice'), TEXT_MAX);
  const version = clip(pick('version', 'textversion', 'noticeversion'), VERSION_MAX);
  const at = isoOf(pick('at', 'time', 'timestamp', 'date', 'agreedat'));
  const formId = clip(pick('formid', 'form'), ID_MAX);
  const adId = clip(pick('adid', 'ad'), ID_MAX);
  const channels = channelsOf(pick('channels', 'channel'));
  if (text) consent.text = text;
  if (version) consent.version = version;
  if (at) consent.at = at;
  if (formId) consent.formId = formId;
  if (adId) consent.adId = adId;
  if (channels) consent.channels = channels;
  return consent;
}

export interface LeadGrantPlan {
  proof: ConsentProof;
  evidence: Record<string, string>;
}

/**
 * What a lead's consent writes, or null when it writes nothing. Needs the sender's yes AND something readable (wording, version, form
 * or ad). The channels are the ones the sender named, else the ones the lead can be reached on; SMS only when named.
 */
export function planLeadGrant(
  consent: LeadConsent | undefined,
  reachable: { phone: boolean; email: boolean },
): LeadGrantPlan | null {
  if (!consent || consent.given !== true) return null;
  if (!(consent.text || consent.version || consent.formId || consent.adId)) return null;
  const named = consent.channels ?? [];
  const channels: IntakeChannel[] = named.length
    ? named.filter((c) => (c === 'email' ? reachable.email : reachable.phone))
    : [
        ...(reachable.phone ? (['whatsapp'] as const) : []),
        ...(reachable.email ? (['email'] as const) : []),
      ];
  if (channels.length === 0) return null;
  const proof: ConsentProof = { channels };
  if (consent.text) proof.text = consent.text;
  if (consent.version) proof.version = consent.version;
  if (consent.at) proof.at = consent.at;
  const evidence: Record<string, string> = {};
  if (consent.formId) evidence.leadFormId = consent.formId;
  if (consent.adId) evidence.adId = consent.adId;
  return { proof, evidence };
}
