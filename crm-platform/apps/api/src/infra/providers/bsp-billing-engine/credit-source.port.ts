/**
 * "Who funds the WABA": the contract between the reseller module and whatever shares a credit line onto a customer's WhatsApp
 * Business Account (TW-BSP-005, -020). Reference shipped one implementation (Meta Solution Partner, "Path A"); an aggregator would
 * be a second adapter behind this token and nothing else in the module would change.
 *
 * Every call takes the connection explicitly: the adapter holds no state, so a settings change applies on the next call and the
 * token never sits in a long-lived object.
 */
export interface CreditSourceConnection {
  businessId: string;
  /** Blank: the adapter finds the business's first extended credit line. */
  extendedCreditId: string;
  token: string;
  graphVersion: string;
}

export type CreditSourceResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface CreditSourcePort {
  /** Stored on the allocation row (`credit_source`). */
  readonly name: 'meta';
  /** Token and business id are present. It does not mean the provider accepts them. */
  isConfigured(conn: Pick<CreditSourceConnection, 'businessId' | 'token'>): boolean;
  /** The credit line to share: the configured one, else the first the business owns. Null when there is none. */
  resolveCreditLine(conn: CreditSourceConnection): Promise<string | null>;
  attach(
    conn: CreditSourceConnection,
    creditLineId: string,
    wabaId: string,
    currency: string,
  ): Promise<CreditSourceResult<{ allocationConfigId: string }>>;
  revoke(
    conn: CreditSourceConnection,
    allocationConfigId: string,
  ): Promise<CreditSourceResult<Record<never, never>>>;
}

export const CREDIT_SOURCE_PORT = Symbol('CREDIT_SOURCE_PORT');
