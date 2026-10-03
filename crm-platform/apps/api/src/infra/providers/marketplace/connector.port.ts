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
}

export interface ConnectorContext {
  recipe: MarketRecipe;
  /** The credential fields the admin entered, opened. */
  credentials: Record<string, string>;
  config: Record<string, unknown>;
}

export interface PullState {
  cursor: string | null;
  /** The previous poll's time, for `{{since_iso}}`. */
  since: Date | null;
  now: Date;
}

export interface PullResult {
  leads: ConnectorLead[];
  rejected: Array<{ index: number; reason: string }>;
  nextCursor: string | null;
}

/** A failure a recipe's error mapping has classified: what the worker does about it and what the connection's health becomes. */
export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retry: boolean,
    readonly health: 'degraded' | 'error' | 'needs_reauth',
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
  /** How a delivery authenticates for this recipe (what the connection page tells the admin to send). */
  describeAuth(recipe: MarketRecipe): {
    auth: 'token' | 'hmac' | 'either';
    tokenHeader: string;
    signatureHeader: string;
  };
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
