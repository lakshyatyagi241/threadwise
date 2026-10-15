import { z } from 'zod';
import {
  consentChannels,
  FORM_LIMITS,
  FORM_RETENTION_DEFAULT_DAYS,
  FORM_RETENTION_MAX_DAYS,
  FORM_RETENTION_MIN_DAYS,
} from '@crm/contracts';
import type { FormConsent, FormLiveSettings } from './types';
import { safeRedirect } from './share';

/**
 * The pure rules of the "What happens next" tab. Each one mirrors a rule of the contract (`formOwnerRuleSchema`, `formNotifySchema`,
 * `formAfterSchema`, `formSettingsSchema`) so the screen says what is wrong before Save instead of after a 400.
 */

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 60;
export const MAX_NOTIFY_EMAILS = 5;
export const MAX_NOTIFY_USERS = 20;
export const MAX_OWNER_USERS = 50;
export const MAX_CONSENT_TEXT = 500;
/** The wording a new consent line starts with (the contract default). */
export const DEFAULT_CONSENT_TEXT = 'I agree to be contacted about my request.';
export const MAX_SUBMIT_LABEL = 60;
export const MAX_SUCCESS_MESSAGE = FORM_LIMITS.maxRichText;

export const RETENTION_RANGE = {
  min: FORM_RETENTION_MIN_DAYS,
  max: FORM_RETENTION_MAX_DAYS,
  fallback: FORM_RETENTION_DEFAULT_DAYS,
} as const;

/** The limits of the three rate limits, as the contract states them. */
export const RATE_LIMIT_RANGES = {
  perIpPerMinute: { min: 1, max: 600 },
  perFormPerMinute: { min: 1, max: 6000 },
  perContactPerHour: { min: 1, max: 100 },
} as const;

// --- owner rule ---------------------------------------------------------------------------------------------------------------------

export type OwnerRuleIssue = 'fixed_one' | 'round_robin_two' | 'unassigned_none' | 'too_many';

export function ownerRuleIssue(rule: FormLiveSettings['ownerRule']): OwnerRuleIssue | null {
  if (rule.userIds.length > MAX_OWNER_USERS) return 'too_many';
  if (rule.mode === 'fixed' && rule.userIds.length !== 1) return 'fixed_one';
  if (rule.mode === 'round_robin' && rule.userIds.length < 2) return 'round_robin_two';
  if (rule.mode === 'unassigned' && rule.userIds.length > 0) return 'unassigned_none';
  return null;
}

/** Switching the mode keeps what still makes sense: nothing for unassigned, the first user for fixed, everyone for round robin. */
export function ownerRuleForMode(
  mode: FormLiveSettings['ownerRule']['mode'],
  current: readonly string[],
): FormLiveSettings['ownerRule'] {
  if (mode === 'unassigned') return { mode, userIds: [] };
  if (mode === 'fixed') return { mode, userIds: current.slice(0, 1) };
  return { mode, userIds: [...current] };
}

// --- lists with a cap: emails and tags --------------------------------------------------------------------------------------------

export type EmailIssue = 'empty' | 'invalid' | 'duplicate' | 'max';

const emailSchema = z.string().max(254).email();

/** One address for the "also email" list: trimmed and lower-cased like the contract does, never twice, at most five. */
export function checkEmail(
  raw: string,
  existing: readonly string[],
  max = MAX_NOTIFY_EMAILS,
): { ok: true; value: string } | { ok: false; issue: EmailIssue } {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, issue: 'empty' };
  if (existing.length >= max) return { ok: false, issue: 'max' };
  if (!emailSchema.safeParse(value).success) return { ok: false, issue: 'invalid' };
  if (existing.includes(value)) return { ok: false, issue: 'duplicate' };
  return { ok: true, value };
}

/** Which of the stored addresses the contract would reject (a list loaded from an older save). */
export function emailsIssue(emails: readonly string[]): EmailIssue | null {
  if (emails.length > MAX_NOTIFY_EMAILS) return 'max';
  for (const e of emails) {
    if (!emailSchema.safeParse(e.trim().toLowerCase()).success) return 'invalid';
  }
  return null;
}

export type TagIssue = 'empty' | 'too_long' | 'duplicate' | 'max';

export function normaliseTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function checkTag(
  raw: string,
  existing: readonly string[],
  max = MAX_TAGS,
): { ok: true; value: string } | { ok: false; issue: TagIssue } {
  const value = normaliseTag(raw);
  if (!value) return { ok: false, issue: 'empty' };
  if (existing.length >= max) return { ok: false, issue: 'max' };
  if (value.length > MAX_TAG_LENGTH) return { ok: false, issue: 'too_long' };
  if (existing.some((t) => t.toLowerCase() === value.toLowerCase())) {
    return { ok: false, issue: 'duplicate' };
  }
  return { ok: true, value };
}

// --- numbers ------------------------------------------------------------------------------------------------------------------------

/** A whole number typed in a box, or null when it is empty, fractional, signed, or outside the range. */
export function parseBoundedInt(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function parseRetention(text: string): number | null {
  return parseBoundedInt(text, RETENTION_RANGE.min, RETENTION_RANGE.max);
}

/** "Keep until I delete them" stores null; unticking it brings back the last number the person had, else the default. */
export function retentionAfterToggle(keepForever: boolean, lastDays: number | null): number | null {
  if (keepForever) return null;
  return lastDays ?? RETENTION_RANGE.fallback;
}

// --- consent ------------------------------------------------------------------------------------------------------------------------

/**
 * Submissions keep the consent version they saw, so once the form has been published a changed wording, or a changed set of channels,
 * must be a new version.
 * The version is derived from the saved copy, not incremented per keystroke: edit back to the saved text and the number returns.
 */
export function consentWithText(
  current: FormConsent,
  text: string,
  saved: FormConsent,
  published: boolean,
): FormConsent {
  const changed =
    text.trim() !== saved.text.trim() ||
    consentChannels(current).join() !== consentChannels(saved).join();
  const version = published && changed ? Math.min(saved.version + 1, 10_000) : saved.version;
  return { ...current, text, version };
}

// The channel sentence and the "last channel stays ticked" rule are shared with the notice editors (one copy, in contact-consent).
export {
  channelStatement as consentStatement,
  toggleChannel as toggleConsentChannel,
} from '@/features/contact-consent';

// --- after submit -------------------------------------------------------------------------------------------------------------------

export type RedirectIssue = 'required' | 'https';

export function redirectIssue(
  mode: 'message' | 'redirect',
  url: string | undefined,
): RedirectIssue | null {
  const v = (url ?? '').trim();
  if (!v) return mode === 'redirect' ? 'required' : null;
  return safeRedirect(v) ? null : 'https';
}

/** The optional privacy or terms page: empty is fine, anything else must be https. */
export function privacyUrlIssue(url: string | undefined): 'https' | null {
  const v = (url ?? '').trim();
  if (!v) return null;
  return safeRedirect(v) ? null : 'https';
}

export function submitLabelIssue(label: string): 'empty' | 'too_long' | null {
  const n = label.trim().length;
  if (n === 0) return 'empty';
  return n > MAX_SUBMIT_LABEL ? 'too_long' : null;
}
