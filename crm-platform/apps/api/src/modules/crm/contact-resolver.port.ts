import type { Tx } from '@crm/db';

/**
 * The CRM's one door for "which contact is this phone number" from a commerce flow (a store order, a catalog cart, a WhatsApp AI order,
 * a mirrored Shopify/WooCommerce order, a saved customer profile). `ContactResolverService` implements it; `CrmModule` provides and
 * exports the token.
 *
 * LEAF FILE: only types and a token, no runtime imports (the `Tx` import is type-only), so a consumer injects `CONTACT_RESOLVER` and
 * imports nothing else from the crm module graph from its own file (see leads/lead-ingest.port.ts for why that matters here).
 */
export const CONTACT_RESOLVER = Symbol('CONTACT_RESOLVER');

export interface ContactResolveInput {
  /** The buyer's number as the channel wrote it (digits with a country code, or E.164 with a "+"). */
  phone: string | null | undefined;
  /** Kept only where the contact has none yet; a name somebody wrote is never replaced. */
  name?: string | null;
  email?: string | null;
  address?: string | null;
  /** `contacts.source` of a contact this call creates ("store", "whatsapp_order", ...). */
  source: string;
  /** Label attached to the contact (created in the workspace when missing and the plan's tag cap allows). Null: none. */
  tag?: string | null;
}

export type ContactSkipReason =
  | 'no_phone'
  | 'unusable_phone'
  /** The plan's `contacts` cap is reached: the caller carries on without a contact link. */
  | 'plan_limit_reached'
  | 'error';

export type ContactLink =
  | { outcome: 'found' | 'created'; contactId: number; contactUuid: string }
  | { outcome: 'skipped'; reason: ContactSkipReason };

export interface ContactResolverPort {
  /**
   * Finds the contact of this workspace that owns the phone, or creates one, inside the CALLER's transaction (so an order and its
   * contact link commit together). Idempotent: the same number again returns the same contact. NEVER throws and never poisons the
   * caller's transaction: the work runs in a savepoint, and a cap, a bad number or an unexpected error is a `skipped` result the
   * caller records as "no contact" (an order is never refused because of its contact).
   */
  findOrCreateByPhone(tx: Tx, orgId: number, input: ContactResolveInput): Promise<ContactLink>;
}
