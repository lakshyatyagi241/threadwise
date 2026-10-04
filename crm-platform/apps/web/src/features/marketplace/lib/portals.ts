import type { MarketConnectionView, MarketMaturity, MarketSyncResult } from '@crm/contracts';

/**
 * What the lead-portal listings (IndiaMART, JustDial, Housing.com, ...) add to the screens, as pure functions: the maturity badge and
 * notice, the private address of a connection whose secret is the last part of its address, the message to the portal's account
 * manager, and "Sync now" for a connection we poll. The components only draw what these return.
 */

export type InboundView = NonNullable<MarketConnectionView['inbound']>;
export type SenderMethod = 'POST' | 'GET';
export type SenderFormat = 'json' | 'form' | 'xml' | 'query';
export const SENDER_FORMATS = [
  'json',
  'form',
  'xml',
  'query',
] as const satisfies readonly SenderFormat[];

// --- maturity ----------------------------------------------------------------------------------------------------------------------

/** The two places the API puts maturity and notice: on the card or the app, and inside its listing. */
export interface MaturitySource {
  maturity?: MarketMaturity | undefined;
  notice?: string | null | undefined;
  listing?: { maturity?: MarketMaturity | undefined; notice?: string | null | undefined } | null;
}

export interface MaturityView {
  maturity: MarketMaturity;
  /** Message key under `marketplace.portals.maturity` for the badge; null for a stable listing (no badge). */
  badge: 'beta' | 'needsPortalSetup' | null;
  badgeTone: 'warning' | 'neutral';
  /** The tone of the notice box: a beta warns, the rest informs. */
  alertTone: 'warning' | 'info';
  /** The operator's one sentence, trimmed; null when there is none. */
  notice: string | null;
}

/** Absent maturity reads as `stable`. The notice of the app wins over the notice of its listing. */
export function maturityView(source: MaturitySource): MaturityView {
  const maturity = source.maturity ?? source.listing?.maturity ?? 'stable';
  const raw = source.notice ?? source.listing?.notice ?? null;
  const notice = raw && raw.trim().length > 0 ? raw.trim() : null;
  return {
    maturity,
    badge:
      maturity === 'beta' ? 'beta' : maturity === 'needs_portal_setup' ? 'needsPortalSetup' : null,
    badgeTone: maturity === 'beta' ? 'warning' : 'neutral',
    alertTone: maturity === 'beta' ? 'warning' : 'info',
    notice,
  };
}

// --- the private address (auth `path`) ---------------------------------------------------------------------------------------------

export const isPathAuth = (inbound: Pick<InboundView, 'auth'> | null | undefined): boolean =>
  inbound?.auth === 'path';

const trimEnd = (v: string) => v.replace(/\/+$/, '');
const trimStart = (v: string) => v.replace(/^\/+/, '');

/** The full address of a `path` connection: the address without its secret, a slash, and the secret. Shown once, never stored. */
export const fullAddress = (url: string, secret: string): string =>
  `${trimEnd(url)}/${trimStart(secret)}`;

/** What the manage page may show of the address: the part it has, then `...` and the end of the secret (`ends in ab12`). */
export function maskedAddress(url: string, secretHint: string | null | undefined): string {
  const m = secretHint ? /^ends in (.+)$/i.exec(secretHint.trim()) : null;
  return `${trimEnd(url)}/...${m ? m[1] : ''}`;
}

/** The methods a sender may use. An older answer without the list has the one method. */
export function senderMethods(inbound: Pick<InboundView, 'method' | 'methods'>): SenderMethod[] {
  return inbound.methods && inbound.methods.length > 0 ? [...inbound.methods] : [inbound.method];
}

/** The body formats a sender may use. An older answer without the list means JSON. */
export function senderFormats(inbound: Pick<InboundView, 'formats'>): SenderFormat[] {
  return inbound.formats && inbound.formats.length > 0 ? [...inbound.formats] : ['json'];
}

/** The part of the reveal payload that comes from the connection and the app, kept in one place so both screens build it the same way. */
export function revealExtras(
  inbound: InboundView | null | undefined,
  portalName: string,
): { methods?: SenderMethod[]; formats?: SenderFormat[]; portalName: string } {
  return inbound
    ? { methods: senderMethods(inbound), formats: senderFormats(inbound), portalName }
    : { portalName };
}

/** A list in the reader's language ("GET or POST", "GET أو POST"). */
export function listText(
  items: readonly string[],
  locale: string,
  type: 'conjunction' | 'disjunction',
): string {
  if (items.length < 2) return items.join('');
  try {
    return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** The translator of `marketplace.portals.message`, reduced to what the builder needs. */
export type MessageText = (key: 'subjectLine' | 'body', values: Record<string, string>) => string;

export interface AccountManagerInput {
  portal: string;
  /** The full address, secret included: the message is the one place it is meant to be handed on. */
  address: string;
  methods: readonly SenderMethod[];
  formats: readonly SenderFormat[];
}

/**
 * A short plain-text email the admin sends to the portal's account manager (who switches the delivery on): what to send, where,
 * how, and a request for one test lead. Every word comes from `text`, so it is written in the reader's language.
 */
export function accountManagerMessage(
  input: AccountManagerInput,
  text: MessageText,
  locale: string,
  formatLabel: (format: SenderFormat) => string,
): string {
  const values = {
    portal: input.portal,
    address: input.address,
    methods: listText(input.methods, locale, 'disjunction'),
    formats: listText(input.formats.map(formatLabel), locale, 'conjunction'),
  };
  return `${text('subjectLine', values)}\n\n${text('body', values)}`;
}

// --- sync now (a connection we poll) -----------------------------------------------------------------------------------------------

/** A run this close to now counts as "right away". */
export const SYNC_IMMEDIATE_SECONDS = 5;

export const isPolled = (connection: Pick<MarketConnectionView, 'type'> | null | undefined) =>
  connection?.type === 'pull';

export interface IntervalParts {
  unit: 'seconds' | 'minutes' | 'hours';
  count: number;
}

/** A minimum interval in the largest whole unit (300 -> 5 minutes, 90 -> 90 seconds). */
export function intervalParts(seconds: number): IntervalParts {
  const s = Math.max(1, Math.round(seconds));
  if (s % 3600 === 0) return { unit: 'hours', count: s / 3600 };
  if (s % 60 === 0) return { unit: 'minutes', count: s / 60 };
  return { unit: 'seconds', count: s };
}

export interface SyncNote {
  /** True when the poll runs within a few seconds: no waiting to explain. */
  immediate: boolean;
  runAt: Date;
  waitSeconds: number;
  /** The portal's minimum gap between two requests, which is why a sync can have to wait. */
  interval: IntervalParts;
}

/** What to tell the person after "Sync now": when it runs and, if it has to wait, the interval the portal asks for. */
export function syncNote(result: MarketSyncResult, now: number): SyncNote {
  const runAt = new Date(result.runAt);
  const waitSeconds = Math.max(0, Math.ceil((runAt.getTime() - now) / 1000));
  return {
    immediate: waitSeconds <= SYNC_IMMEDIATE_SECONDS,
    runAt,
    waitSeconds,
    interval: intervalParts(result.minIntervalSeconds),
  };
}

// --- the connection panel ----------------------------------------------------------------------------------------------------------

/** A portal that sends leads to us and has not sent one yet: its own team has to switch the delivery on. */
export const waitingForFirstLead = (
  connection: Pick<MarketConnectionView, 'type' | 'lastEventAt'> | null | undefined,
): boolean => connection?.type === 'push' && connection.lastEventAt === null;

/** For a polled connection that stopped on an error: what to try. `null` when there is nothing to say. */
export function pullErrorHint(
  connection: Pick<MarketConnectionView, 'type' | 'status'> | null | undefined,
  canSync: boolean,
): 'withSync' | 'withoutSync' | null {
  if (!connection || connection.type !== 'pull' || connection.status !== 'error') return null;
  return canSync ? 'withSync' : 'withoutSync';
}
