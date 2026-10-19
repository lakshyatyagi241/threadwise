/**
 * The lead pipeline's port: the one door a lead goes through, whatever brought it (the generic webhook, Meta lead forms, a marketplace
 * connector for IndiaMART or JustDial, a manual test). `LeadIngestService` is the only writer of lead-originated contacts and
 * implements it.
 *
 * LEAF FILE: it imports nothing, on purpose. Other domains inject `LEAD_INGEST` by token and import only this file (never the leads
 * barrel or a service), so a connector's module does not pull the CRM, the plans and the notifications modules into its own import
 * graph. In this repo a module that imports another domain's classes can close a file cycle that leaves a class `undefined` while Nest
 * reads its constructor (the same reason `whatsapp-cloud-api-waba/waba-connections.port.ts` exists). The module that provides the token
 * is `LeadIngestModule`, exported from the leads barrel.
 *
 * A caller passes the internal `orgId` and `sourceId` it was given when its source was registered (see `lead-source-directory.port.ts`),
 * never one read from a request: the tenant is whatever the caller proved, not what a payload claims.
 */
export const LEAD_INGEST = Symbol('LEAD_INGEST');

/**
 * Proof that the person agreed to be contacted, as the sender supplies it (BL-168, privacy spec 4.3.2). OPTIONAL and never inferred: a
 * lead that arrives without it grants nothing, and a lead whose `given` is not `true` grants nothing whatever else it carries. A grant
 * also needs something a person can read later (the wording, its version, or the form or ad they agreed on).
 */
export interface LeadConsent {
  /** The sender says the person agreed (a ticked consent box on the lead form). Only `true` can grant. */
  given: boolean;
  /** The wording the person was shown (cut to 300 characters in the evidence, the hash of the whole text kept). */
  text?: string;
  /** The version of that wording. */
  version?: string;
  /** ISO 8601 time they agreed, when that was before the lead was delivered. Omitted: when the lead was received. */
  at?: string;
  /** The provider's own lead form id, and the ad that brought the person to it. */
  formId?: string;
  adId?: string;
  /** The channels the wording covers. Omitted: a phone is WhatsApp, an address is email. SMS is granted only when named here. */
  channels?: Array<'whatsapp' | 'sms' | 'email'>;
}

/** One lead, as a door hands it over. */
export interface NormalisedLead {
  /** The sender's own id for this lead. `(source, externalId)` is the idempotency key: the same pair twice is acknowledged, not repeated. */
  externalId: string;
  /** ISO 8601 time the lead was submitted at the provider, when it says. Defaults to now. */
  receivedAt?: string;
  /**
   * The lead's values by name: `full_name`, `email`, `phone_number`, or any key the source's field mapping points at. A connector that
   * already knows our names uses them; a webhook's body is flattened (`lead.phone`). The source's mapping decides what each means.
   */
  fields: Record<string, string | number | boolean | null>;
  attribution?: {
    platform?: string;
    campaign?: string;
    adset?: string;
    ad?: string;
    form?: string;
  };
  /** Proof that the person agreed to be contacted, when the sender has it (see `LeadConsent`). Without it the lead grants nothing. */
  consent?: LeadConsent;
  /** The provider's payload untouched, kept for the source's retention period so a mapping can be fixed and the lead retried. */
  raw?: unknown;
}

export interface LeadIngestResult {
  /**
   * created: a new contact. updated: an existing contact matched and got the lead's new facts and a new attribution.
   * duplicate: this `(source, externalId)` was already received (nothing was written). needs_review: stored but not turned into a contact
   * (no usable email or phone, or the plan's contact cap is reached); `reason` says which. failed: an unexpected error; `reason` is
   * `internal_error` and the lead is stored for a retry.
   */
  status: 'created' | 'updated' | 'duplicate' | 'needs_review' | 'failed';
  /** Internal ids, for the caller's own bookkeeping. They never go on the wire. */
  contactId?: number;
  dealId?: number;
  reason?: string;
}

export interface LeadIngestPort {
  ingest(orgId: number, sourceId: number, lead: NormalisedLead): Promise<LeadIngestResult>;
  /**
   * For a connector that reads a provider's recent leads on a schedule (a reconciliation sweep): of these external ids, the ones the
   * source already holds and does not need again (anything but a `failed` event or a `received` one that stalled). Asking first keeps
   * a sweep from counting every lead it re-reads as a duplicate delivery. Optional: a caller without it just ingests, which is
   * correct, only noisier.
   */
  settled?(orgId: number, sourceId: number, externalIds: readonly string[]): Promise<string[]>;
}
