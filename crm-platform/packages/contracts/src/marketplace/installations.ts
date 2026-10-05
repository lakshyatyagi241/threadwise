import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import {
  connectorTypeSchema,
  marketAppKindSchema,
  marketConnectionStatusSchema,
  marketDataChoiceSchema,
  marketHealthSchema,
  marketInstallStatusSchema,
  marketSlugSchema,
} from './enums';
import { marketCardPricingSchema, marketSubscriptionSchema } from './pricing';
import { marketScopeSummarySchema } from './scopes';

/**
 * A workspace's installations: install with consent, configure, test, uninstall, health. Reads need `market.apps.read`; install,
 * re-consent and uninstall need `market.apps.install`; configure, pause, test and rotate need `market.apps.manage`.
 *
 * Secrets are write-only. A credential field the admin supplied comes back only as `{ isSet, hint }` (the last four characters).
 * The one value the platform itself generates, a connection's inbound secret, is shown once in the answer that creates or rotates it.
 */

const credentialValuesSchema = z
  .record(z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/), z.string().max(2000))
  .default({});
const configValuesSchema = z
  .record(z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/), z.unknown())
  .default({});

export const installAppSchema = z
  .object({
    /** The permission list the admin confirmed. It must equal the scopes of the version being installed. */
    acceptedScopes: z.array(z.string().max(60)).max(30),
    credentials: credentialValuesSchema,
    config: configValuesSchema.refine(
      (c) => JSON.stringify(c).length <= 16_384,
      'The configuration is at most 16 KB.',
    ),
  })
  .strict();
export type InstallAppInput = z.infer<typeof installAppSchema>;
export type InstallAppRequest = z.input<typeof installAppSchema>;

export const configureInstallationSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    config: configValuesSchema.optional(),
    /** Fields given here replace the stored secret; fields left out keep theirs. */
    credentials: z
      .record(z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/), z.string().max(2000))
      .optional(),
    clearCredentials: z.array(z.string().max(40)).max(10).optional(),
  })
  .strict();
export type ConfigureInstallationInput = z.infer<typeof configureInstallationSchema>;

/** Accepting the permission list of a newer version that asks for more than was granted. */
export const consentInstallationSchema = z
  .object({ acceptedScopes: z.array(z.string().max(60)).max(30) })
  .strict();
export type ConsentInstallationInput = z.infer<typeof consentInstallationSchema>;

export const uninstallAppSchema = z.object({ dataChoice: marketDataChoiceSchema }).strict();
export type UninstallAppInput = z.infer<typeof uninstallAppSchema>;

export const installationStateActionSchema = z
  .object({ rowVersion: z.number().int().positive() })
  .strict();
export type InstallationStateActionInput = z.infer<typeof installationStateActionSchema>;

export const sendSampleLeadSchema = z
  .object({ payloadName: z.string().trim().max(60).optional() })
  .strict();
export type SendSampleLeadInput = z.infer<typeof sendSampleLeadSchema>;

// --- shapes ----------------------------------------------------------------------------------------------------------------------

export const marketCredentialStateSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['secret', 'text', 'select']),
  isSet: z.boolean(),
  /** `ends in ####` for a secret; the value itself for a plain text field; null when not set. */
  hint: z.string().nullable(),
});

export const marketConnectionViewSchema = z.object({
  id: uuidSchema,
  type: connectorTypeSchema,
  status: marketConnectionStatusSchema,
  /** The address a sender posts to (push and webhook relay). The path carries a public key only; authentication is the secret. */
  inbound: z
    .object({
      url: z.string(),
      /** The method a sender uses first (`GET` for a portal that delivers in the query string); `methods` lists every one the address answers. */
      method: z.enum(['POST', 'GET']),
      /**
       * `path`: the secret is the last segment of the address, so the full address is `url` + `/` + the secret, which is shown once (in
       * the answer that installs or rotates) and never again; `secretHint` says which one it is.
       */
      auth: z.enum(['token', 'hmac', 'either', 'path']),
      tokenHeader: z.string(),
      signatureHeader: z.string(),
      secretHint: z.string().nullable(),
      methods: z.array(z.enum(['POST', 'GET'])).optional(),
      /** `json`, `form`, `xml`, `query` (the URL's query string). */
      formats: z.array(z.enum(['json', 'form', 'xml', 'query'])).optional(),
      /** `async`: stored whole and answered at once, processed by the worker; `sync`: answered after the lead reached the pipeline. */
      delivery: z.enum(['sync', 'async']).optional(),
    })
    .nullable(),
  pollIntervalSeconds: z.number().int().nullable(),
  /** The next poll of a pull connection (null for the others, and while the connection is stopped). */
  nextPollAt: z.string().datetime().nullable().optional(),
  /** Leads up to this time have been fetched (a pull connection that works in time windows). */
  syncedThrough: z.string().datetime().nullable().optional(),
  /** Fewest seconds between two requests to the portal: what a Sync now waits for. */
  minSyncIntervalSeconds: z.number().int().nullable().optional(),
  lastEventAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  counters: z.object({
    received: z.number().int(),
    accepted: z.number().int(),
    duplicates: z.number().int(),
    failed: z.number().int(),
  }),
});
export type MarketConnectionView = z.infer<typeof marketConnectionViewSchema>;

export const marketInstallationSchema = z.object({
  id: uuidSchema,
  app: z.object({
    id: uuidSchema,
    slug: marketSlugSchema,
    name: z.string(),
    kind: marketAppKindSchema,
    logo: z.string().nullable(),
    category: z.object({ slug: marketSlugSchema, name: z.string() }),
    connectorType: connectorTypeSchema.nullable(),
  }),
  status: marketInstallStatusSchema,
  health: z.object({
    status: marketHealthSchema,
    checkedAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().datetime().nullable(),
  }),
  version: z.string(),
  /** A newer published version that asks for more permissions than were granted. The installation runs on `version` until it is accepted. */
  pendingVersion: z
    .object({
      version: z.string(),
      newScopes: z.array(marketScopeSummarySchema),
      scopes: z.array(marketScopeSummarySchema),
    })
    .nullable(),
  needsReconsent: z.boolean(),
  grantedScopes: z.array(marketScopeSummarySchema),
  config: z.record(z.string(), z.unknown()),
  credentials: z.array(marketCredentialStateSchema),
  connection: marketConnectionViewSchema.nullable(),
  killReason: z.string().nullable(),
  /** `subscription_ended`: paused because the paid app's subscription ended (data kept; subscribing again switches it back on). */
  pauseReason: z.enum(['subscription_ended']).nullable(),
  /** What the app costs and what that means for this workspace (the same view as the app page). */
  pricing: marketCardPricingSchema,
  /** The workspace's subscription to the app, when it has one. */
  subscription: marketSubscriptionSchema.nullable(),
  installedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  installedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type MarketInstallation = z.infer<typeof marketInstallationSchema>;

/** The answer to an install or a secret rotation: the installation, plus the connection secret, shown this once. */
export const marketInstallResultSchema = z.object({
  installation: marketInstallationSchema,
  inboundSecret: z.string().nullable(),
});
export type MarketInstallResult = z.infer<typeof marketInstallResultSchema>;

export const marketInstallationListQuerySchema = z.object({
  kind: marketAppKindSchema.optional(),
  status: marketInstallStatusSchema.optional(),
});
export type MarketInstallationListQuery = z.infer<typeof marketInstallationListQuerySchema>;
export const marketInstallationListSchema = z.object({
  data: z.array(marketInstallationSchema),
  usage: z.object({ installed: z.number().int(), limit: z.number().int() }),
});
export type MarketInstallationList = z.infer<typeof marketInstallationListSchema>;

export const marketTestResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  latencyMs: z.number().int(),
  checkedAt: z.string().datetime(),
});
export type MarketTestResult = z.infer<typeof marketTestResultSchema>;

/**
 * "Sync now" (a pull connection): the poll is brought forward, never faster than the portal allows. `runAt` is when it will run (now when
 * the portal's minimum interval has passed, else the moment it does); a connection that had stopped on an error is started again.
 */
export const marketSyncResultSchema = z.object({
  status: z.literal('scheduled'),
  runAt: z.string().datetime(),
  minIntervalSeconds: z.number().int(),
});
export type MarketSyncResult = z.infer<typeof marketSyncResultSchema>;

export const marketSampleLeadResultSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  externalId: z.string(),
});
export type MarketSampleLeadResult = z.infer<typeof marketSampleLeadResultSchema>;

export const marketConnectionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type MarketConnectionEventsQuery = z.infer<typeof marketConnectionEventsQuerySchema>;

export const marketConnectionEventSchema = z.object({
  id: uuidSchema,
  externalId: z.string().nullable(),
  status: z.enum(['accepted', 'duplicate', 'rejected', 'failed']),
  error: z.string().nullable(),
  receivedAt: z.string().datetime(),
});
export const marketConnectionEventListSchema = z.object({
  data: z.array(marketConnectionEventSchema),
  page: pageInfoSchema,
});
export type MarketConnectionEventList = z.infer<typeof marketConnectionEventListSchema>;
