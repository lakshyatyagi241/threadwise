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
}
