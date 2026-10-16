import {
  FB_PAGE_STATUSES,
  META_LEAD_ACCESS,
  META_LEAD_SYNC_STATES,
  type MetaLeadAdsOverview,
  type MetaLeadForm,
  type MetaLeadPage,
  type MetaLeadSyncState,
} from '@crm/contracts';
import type { Tone } from './event-view';

/**
 * How the Meta lead forms panel reads a Page and a form: the colour of each state, which actions a Page offers to this person and
 * why one is held back, and the numbers on the provider card. Pure, so every state of the contract has a test. The server stays the
 * authority: a held-back action is only a hint, never the only guard.
 */

export const META_SYNC_STATES = META_LEAD_SYNC_STATES;
export const META_PAGE_STATUSES = FB_PAGE_STATUSES;
export const META_LEAD_ACCESS_VALUES = META_LEAD_ACCESS;
/** Meta's own status words of a form; anything else is shown as "unknown". */
export const META_FORM_STATUSES = ['ACTIVE', 'ARCHIVED', 'DELETED', 'DRAFT'] as const;

export const SYNC_TONE: Record<MetaLeadSyncState, Tone> = {
  off: 'neutral',
  subscribed: 'success',
  needs_lead_access: 'warning',
  needs_reconnect: 'warning',
  error: 'danger',
};

export const PAGE_STATUS_TONE: Record<MetaLeadPage['pageStatus'], Tone> = {
  connected: 'success',
  disconnected: 'neutral',
  expired: 'warning',
  error: 'danger',
};

export const ACCESS_TONE: Record<MetaLeadPage['leadAccess'], Tone> = {
  granted: 'success',
  missing: 'warning',
};

/** The key under `lead-sources.meta.formStatus` for a form's Meta status. */
export const formStatusKey = (status: string | null): string =>
  (META_FORM_STATUSES as readonly string[]).includes(status ?? '') ? (status as string) : 'unknown';

// --- what a Page offers -------------------------------------------------------------------------------------------------------

/** Why "Choose lead forms" is held back; the key under `lead-sources.meta.page.hints`. */
export type PickBlock = 'syncOff' | 'leadAccess' | 'reconnect';

export interface PageActions {
  /** Both logins are the same Facebook round trip; which one the Page needs decides the button's words. */
  login: 'grant' | 'reconnect' | null;
  toggle: 'enable' | 'disable';
  /** Turning on is refused by the server until the Page is reconnected or has lead access; the button says why. */
  toggleBlock: PickBlock | null;
  pickBlock: PickBlock | null;
}

export interface PageCaps {
  /** `leads.sources.manage`. */
  manage: boolean;
  /** `fb.pages.manage`: the login stores Page tokens. */
  facebook: boolean;
}

export const needsReconnect = (p: MetaLeadPage): boolean =>
  p.sync.state === 'needs_reconnect' ||
  p.pageStatus === 'expired' ||
  p.pageStatus === 'disconnected';

export const needsLeadAccess = (p: MetaLeadPage): boolean =>
  p.leadAccess === 'missing' || p.sync.state === 'needs_lead_access';

export function pageActions(p: MetaLeadPage): PageActions {
  const reconnect = needsReconnect(p);
  const grant = !reconnect && needsLeadAccess(p);
  const login = reconnect ? 'reconnect' : grant ? 'grant' : null;
  const block: PickBlock | null = reconnect ? 'reconnect' : grant ? 'leadAccess' : null;
  return {
    login,
    toggle: p.sync.enabled ? 'disable' : 'enable',
    // Turning lead sync off is always possible; turning it on needs a working token and the lead permissions.
    toggleBlock: p.sync.enabled ? null : block,
    pickBlock: block ?? (p.sync.enabled ? null : 'syncOff'),
  };
}

/** The message key (under `lead-sources.meta.page.hints`) that says why a button is held back. */
export function blockHintKey(action: 'enable' | 'pick', block: PickBlock): string {
  if (action === 'enable')
    return block === 'reconnect' ? 'enableNeedsReconnect' : 'enableNeedsAccess';
  return block === 'reconnect'
    ? 'pickNeedsReconnect'
    : block === 'leadAccess'
      ? 'pickNeedsAccess'
      : 'pickNeedsSync';
}

// --- the provider card --------------------------------------------------------------------------------------------------------

export interface MetaSummary {
  configured: boolean;
  pages: number;
  /** Pages whose lead sync is on and healthy. */
  live: number;
  forms: number;
  /** Pages that need a person to do something (grant, reconnect) or whose last call failed. */
  attention: number;
}

export function metaSummary(o: MetaLeadAdsOverview): MetaSummary {
  return {
    configured: o.configured,
    pages: o.pages.length,
    live: o.pages.filter((p) => p.sync.state === 'subscribed').length,
    forms: o.pages.reduce((n, p) => n + p.sync.formsConnected, 0),
    attention: o.pages.filter(
      (p) =>
        p.sync.state === 'needs_lead_access' ||
        p.sync.state === 'needs_reconnect' ||
        p.sync.state === 'error',
    ).length,
  };
}

/** The overview with one Page replaced by the server's fresh copy (after turning lead sync on or off). */
export function withPage(o: MetaLeadAdsOverview, page: MetaLeadPage): MetaLeadAdsOverview {
  return { ...o, pages: o.pages.map((p) => (p.id === page.id ? page : p)) };
}

// --- the form table -----------------------------------------------------------------------------------------------------------

/** Connected forms first, then the rest in the order Meta listed them. */
export function sortForms(forms: readonly MetaLeadForm[]): MetaLeadForm[] {
  return [...forms].sort((a, b) => Number(b.connected) - Number(a.connected));
}

// --- the login round trip -----------------------------------------------------------------------------------------------------

export interface ConnectNotice {
  ok: boolean;
  text: string;
}

/** Longest text of the callback's `message` that is shown; it comes from the address bar and is only ever rendered as text. */
const NOTICE_MAX = 300;

/**
 * The Facebook login comes back to `/lead-sources?tab=ads&fb=connected|error&message=...`. Anything but a known `fb` value, or a
 * missing message, is no notice.
 */
export function parseConnectNotice(params: {
  get(name: string): string | null;
}): ConnectNotice | null {
  const fb = params.get('fb');
  const text = params.get('message')?.trim();
  if ((fb !== 'connected' && fb !== 'error') || !text) return null;
  return { ok: fb === 'connected', text: text.slice(0, NOTICE_MAX) };
}

/**
 * The address the browser is sent to for the Facebook login. It comes from our own API, but a script address would run in this page,
 * so only a web address is followed.
 */
export function safeLoginUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
