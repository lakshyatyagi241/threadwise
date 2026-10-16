import {
  LEAD_SOURCE_KINDS,
  type LeadSourceKind,
  type LeadSourceResponse,
  type LeadSourceStatus,
} from '@crm/contracts';
import type { Tone } from './event-view';

/** Routes and the small view-models of the sources list and the source header. */

export const ROUTES = {
  list: '/lead-sources',
  webhooks: '/lead-sources?tab=webhook',
  ads: '/lead-sources?tab=ads',
  inbox: '/lead-sources?tab=inbox',
  create: '/lead-sources/new',
  marketplaceInstalled: '/marketplace/installed',
} as const;

export const sourceHref = (id: string): string => `/lead-sources/${encodeURIComponent(id)}`;
export const contactHref = (id: string): string => `/contacts/${encodeURIComponent(id)}`;

/** The link of the "needs attention" badge: the source's events, filtered to the leads that wait. */
export const attentionHref = (id: string): string => `${sourceHref(id)}?events=attention#events`;

export const TABS = ['ads', 'webhook', 'inbox'] as const;
export type LeadTab = (typeof TABS)[number];
export const parseTab = (value: string | null | undefined): LeadTab =>
  value === 'webhook' || value === 'inbox' ? value : 'ads';

/** Where each tab lives (the tab is the address, so a link to the inbox opens it). */
export const TAB_ROUTES: Record<LeadTab, string> = {
  ads: '/lead-sources',
  webhook: '/lead-sources?tab=webhook',
  inbox: '/lead-sources?tab=inbox',
};

/** Kinds shown by name (`lead-sources.kinds.<kind>`). */
export const SOURCE_KINDS: readonly LeadSourceKind[] = LEAD_SOURCE_KINDS;

/** A connector source belongs to a Marketplace install: it has no URL or token to show, rotate or paste. */
export const isConnector = (s: Pick<LeadSourceResponse, 'kind'>): boolean => s.kind === 'connector';

export const canRotate = (s: Pick<LeadSourceResponse, 'kind'>): boolean => !isConnector(s);

export const STATUS_TONE: Record<LeadSourceStatus, Tone> = { active: 'success', paused: 'neutral' };

/** "ends in x9Qk": the hint only, never a token. */
export const tokenHintOf = (s: Pick<LeadSourceResponse, 'tokenHint'>): string | null =>
  s.tokenHint && s.tokenHint.trim() !== '' ? s.tokenHint : null;

export interface SourceRow {
  id: string;
  name: string;
  kind: LeadSourceKind;
  status: LeadSourceStatus;
  tokenHint: string | null;
  lastEventAt: string | null;
  needsAttention: number;
  href: string;
  /** Set only when something waits: where the badge leads. */
  attentionHref: string | null;
  connector: boolean;
}

export function sourceRow(s: LeadSourceResponse): SourceRow {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    status: s.status,
    tokenHint: isConnector(s) ? null : tokenHintOf(s),
    lastEventAt: s.lastEventAt,
    needsAttention: s.needsAttention,
    href: sourceHref(s.id),
    attentionHref: s.needsAttention > 0 ? attentionHref(s.id) : null,
    connector: isConnector(s),
  };
}

export const sourceRows = (sources: readonly LeadSourceResponse[]): SourceRow[] =>
  sources.map(sourceRow);

export const attentionTotal = (
  sources: readonly Pick<LeadSourceResponse, 'needsAttention'>[],
): number => sources.reduce((sum, s) => sum + s.needsAttention, 0);

/** Kinds this build has no door for: shown on the Ads tab as "coming soon", never as a working button. */
export const COMING_SOON_PROVIDERS = ['meta', 'linkedin', 'tiktok', 'google'] as const;
export type ComingSoonProvider = (typeof COMING_SOON_PROVIDERS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The address segment of a source is checked before any call: an id that is not a uuid is a 404 without asking the API. */
export const isUuid = (value: string): boolean => UUID.test(value);
