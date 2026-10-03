import { z } from 'zod';

/** The two tabs of the Marketplace. */
export const MARKET_APP_KINDS = ['mini_app', 'integration'] as const;
export const marketAppKindSchema = z.enum(MARKET_APP_KINDS);
export type MarketAppKind = z.infer<typeof marketAppKindSchema>;

/** Listing lifecycle (platform-owned). Only `published` appears in browse and search. */
export const MARKET_APP_STATUSES = ['draft', 'in_review', 'published', 'hidden', 'killed'] as const;
export const marketAppStatusSchema = z.enum(MARKET_APP_STATUSES);
export type MarketAppStatus = z.infer<typeof marketAppStatusSchema>;

/** A version: draft -> in_review -> approved | rejected -> published -> retired (when a newer one is published). */
export const MARKET_VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'published',
  'retired',
] as const;
export const marketVersionStatusSchema = z.enum(MARKET_VERSION_STATUSES);
export type MarketVersionStatus = z.infer<typeof marketVersionStatusSchema>;

/** `disabled` is the admin's pause; `killed` is the platform's kill switch (only uninstalling is possible). */
export const MARKET_INSTALL_STATUSES = ['active', 'disabled', 'killed'] as const;
export const marketInstallStatusSchema = z.enum(MARKET_INSTALL_STATUSES);
export type MarketInstallStatus = z.infer<typeof marketInstallStatusSchema>;

export const MARKET_HEALTH_STATES = [
  'unknown',
  'healthy',
  'degraded',
  'error',
  'needs_reauth',
] as const;
export const marketHealthSchema = z.enum(MARKET_HEALTH_STATES);
export type MarketHealth = z.infer<typeof marketHealthSchema>;

/** The five mechanisms every integration is a variation of (spec 6.3). */
export const CONNECTOR_TYPES = ['oauth', 'push', 'pull', 'email_parse', 'webhook_relay'] as const;
export const connectorTypeSchema = z.enum(CONNECTOR_TYPES);
export type ConnectorKind = z.infer<typeof connectorTypeSchema>;

export const MARKET_CONNECTION_STATUSES = ['active', 'paused', 'error', 'disabled'] as const;
export const marketConnectionStatusSchema = z.enum(MARKET_CONNECTION_STATUSES);
export type MarketConnectionStatus = z.infer<typeof marketConnectionStatusSchema>;

/** What the admin chose for the data an app created when uninstalling. */
export const MARKET_DATA_CHOICES = ['keep', 'delete'] as const;
export const marketDataChoiceSchema = z.enum(MARKET_DATA_CHOICES);
export type MarketDataChoice = z.infer<typeof marketDataChoiceSchema>;

export const MARKET_REQUEST_STATUSES = [
  'open',
  'planned',
  'building',
  'shipped',
  'declined',
] as const;
export const marketRequestStatusSchema = z.enum(MARKET_REQUEST_STATUSES);
export type MarketRequestStatus = z.infer<typeof marketRequestStatusSchema>;

export const MARKET_CONSENT_ACTIONS = ['install', 'reconsent', 'uninstall'] as const;
export type MarketConsentAction = (typeof MARKET_CONSENT_ACTIONS)[number];

export const MARKET_EVENT_STATUSES = ['accepted', 'duplicate', 'rejected', 'failed'] as const;
export type MarketEventStatus = (typeof MARKET_EVENT_STATUSES)[number];

/** A slug is a machine key in URLs: lowercase letters, digits and dashes, starting with a letter. */
export const MARKET_SLUG_RE = /^[a-z][a-z0-9-]{1,47}$/;
export const marketSlugSchema = z
  .string()
  .regex(
    MARKET_SLUG_RE,
    'Use 2 to 48 lowercase letters, digits or dashes, starting with a letter.',
  );

/** `MAJOR.MINOR.PATCH`, with an optional pre-release tag. */
export const MARKET_SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9a-z.]{1,20})?$/;

/** Compares two versions: negative when `a` is older. Pre-release tags sort before the release. */
export function compareMarketVersions(a: string, b: string): number {
  const [aMain = '', aPre = ''] = a.split('-', 2);
  const [bMain = '', bPre = ''] = b.split('-', 2);
  const ap = aMain.split('.').map(Number);
  const bp = bMain.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (d !== 0) return d;
  }
  if (aPre === bPre) return 0;
  if (aPre === '') return 1;
  if (bPre === '') return -1;
  return aPre < bPre ? -1 : 1;
}
