import type { ConnectorKind, MarketRecipe } from '@crm/contracts';

/**
 * The connector framework's port (M-05). An integration is described by a recipe (data) and run by one of five connector types. A type
 * knows how to authenticate a delivery, turn a payload into leads, test itself, and (pull) fetch on a schedule. Everything above this
 * file is written against these shapes; a type is one file below it.
 *
 * `ConnectorLead` is the same shape as `NormalisedLead` of the lead pipeline's port (modules/leads/lead-ingest.port.ts). It is declared here
 * as well so the adapter layer, which may not import a domain module, stays self-contained; the marketplace module hands it to the pipeline
 * unchanged.
 */

export type ConnectorFieldValue = string | number | boolean | null;

export interface ConnectorLead {
  externalId: string;
  receivedAt?: string;
  fields: Record<string, ConnectorFieldValue>;
  attribution?: {
    platform?: string;
    campaign?: string;
    adset?: string;
    ad?: string;
    form?: string;
  };
  /** Proof the person agreed to be contacted, when the portal sends it (the recipe's `consent` mapping). Same shape as `LeadConsent`. */
  consent?: {
    given: boolean;
    text?: string;
    version?: string;
    at?: string;
    formId?: string;
    adId?: string;
    channels?: Array<'whatsapp' | 'sms' | 'email'>;
  };
  raw?: unknown;
}

export interface ConnectorProblem {
  path: string;
  message: string;
}

export interface ConnectorTestResult {
  ok: boolean;
  code: string | null;
  message: string | null;
}

/** What a delivery produced: the leads that were mapped and the items that could not be (with the reason), for the event log. */
export interface ParsedDelivery {
  leads: ConnectorLead[];
  rejected: Array<{ index: number; reason: string }>;
}

export interface InboundRequest {
  /** The exact bytes received (a signature is over these, never over a re-serialised body). */
  rawBody: Buffer;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  /** The secret carried as the second segment of the address (`/hooks/<publicKey>/<secret>`), when the request has one. */
  pathToken?: string;
}

/** How a recipe's connection receives deliveries: what authenticates one, what it may carry, and when it is answered. */
export interface InboundDescription {
  /** `path`: the secret is in the address. */
  auth: 'token' | 'hmac' | 'either' | 'path';
  tokenHeader: string;
  signatureHeader: string;
  methods: Array<'POST' | 'GET'>;
  formats: Array<'json' | 'form' | 'xml' | 'query'>;
  /** `async`: stored whole and answered at once, processed by the worker. `sync`: answered after the lead reached the pipeline. */
  mode: 'sync' | 'async';
}

export interface ConnectorContext {
  recipe: MarketRecipe;
  /** The credential fields the admin entered, opened. */
  credentials: Record<string, string>;
  config: Record<string, unknown>;
}

export interface PullState {
  /** The resume point: the greatest id seen (a `cursor` recipe) or the end of the last window as an ISO time (a `window` recipe). */
  cursor: string | null;
  /** The previous poll's time, for `{{since_iso}}`. */
  since: Date | null;
  now: Date;
  /** A narrower window than the recipe's own, when the last one held more leads than one answer carries. */
  windowSeconds?: number | null;
  /** Test connection: a short recent window, and nothing is kept. */
  test?: boolean;
}

export interface PullResult {
  leads: ConnectorLead[];
  rejected: Array<{ index: number; reason: string }>;
  /** A `cursor` recipe: where the next poll resumes. */
  nextCursor: string | null;
  /** A `window` recipe: the end of the window this poll covered (the next poll's high-water mark), and whether time is still left to cover. */
  windowEnd?: Date | null;
  behind?: boolean;
  /** The window held more leads than one answer carries: nothing was mapped, ask again for a narrower one. */
  overflow?: boolean;
  /** How wide the window was, in seconds. */
  windowSeconds?: number | null;
  /** Items the portal returned (before mapping). */
  fetched: number;
}

/** A failure a recipe's error mapping has classified: what the worker does about it and what the connection's health becomes. */
export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retry: boolean,
    readonly health: 'degraded' | 'error' | 'needs_reauth',
    /** The portal's stated penalty or wait, in seconds: the next poll is no sooner. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorType {
  readonly kind: ConnectorKind;
  /**
   * True when the type works end to end and a listing that uses it may be published. A type that is only a framework (its recipes
   * come with the first portal that needs it) is registered with false, so nothing non-functional can reach a workspace.
   */
  readonly implemented: boolean;
  /** Accepts deliveries at the public address. */
  readonly inbound: boolean;
  /** Is polled by the worker. */
  readonly polls: boolean;

  /** Problems with a recipe that the schema cannot see (type specific). */
  checkRecipe(recipe: MarketRecipe): ConnectorProblem[];
  test(ctx: ConnectorContext): Promise<ConnectorTestResult>;
}

/** A type that receives deliveries. */
export interface InboundConnectorType extends ConnectorType {
  /**
   * How a delivery authenticates and what it may carry for this recipe (what the connection page tells the admin to send). Null when the
   * recipe has no public address (a pull recipe that does not also receive).
   */
  describeAuth(recipe: MarketRecipe): InboundDescription | null;
  /** True when the request proves it came from the holder of `secret`. */
  authenticate(recipe: MarketRecipe, req: InboundRequest, secret: string): boolean;
  /** Which secret authenticates deliveries: the connection's generated one, or an auth field the recipe names. */
  secretFor(
    recipe: MarketRecipe,
    credentials: Record<string, string>,
    connectionSecret: string | null,
  ): string | null;
  parse(recipe: MarketRecipe, body: unknown): ParsedDelivery;
}

export interface PullConnectorType extends ConnectorType {
  pull(ctx: ConnectorContext, state: PullState): Promise<PullResult>;
}

export const isInbound = (t: ConnectorType): t is InboundConnectorType =>
  t.inbound && typeof (t as Partial<InboundConnectorType>).authenticate === 'function';
export const isPuller = (t: ConnectorType): t is PullConnectorType =>
  t.polls && typeof (t as Partial<PullConnectorType>).pull === 'function';
