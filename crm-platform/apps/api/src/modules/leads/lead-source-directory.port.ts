/**
 * How a connector gets a lead source of its own (a second leaf port, next to `lead-ingest.port.ts`, with the same rule: no imports).
 *
 * A marketplace connector (IndiaMART, JustDial, Meta lead forms) is not a URL a workspace admin creates, it is an installation. When one
 * is installed it asks the directory for its source once, passing a stable reference of its own (the installation's id); asking again
 * with the same reference returns the same source, so a reinstall or a retry never makes a second one. The source is `kind: connector`,
 * has no URL token, counts toward the plan's `lead_sources` limit, and the admin tunes its mapping and owner rules in the same screen as
 * a webhook's. Removing the connector calls `releaseConnectorSource`, which deletes the source and, with it, its stored events.
 */
export const LEAD_SOURCE_DIRECTORY = Symbol('LEAD_SOURCE_DIRECTORY');

export interface ConnectorSourceInput {
  /**
   * The source's kind. Omitted: `connector` (a Marketplace installation). `meta_lead_ads` is a lead form of a connected Facebook Page
   * (one source per form). Either kind has no URL token and is edited in the same screen as a webhook's mapping and rules.
   */
  kind?: 'connector' | 'meta_lead_ads';
  /** The platform label of its leads ("IndiaMART"): the default `contacts.source` and attribution platform. */
  providerKey: string;
  /** Stable and unique per workspace: the installation's id. */
  externalRef: string;
  /** Shown in the lead sources screen. */
  name: string;
}

export interface LeadSourceDirectoryPort {
  /** The source for this reference, created on first use. Idempotent. Throws the plan's limit error when the workspace is at its cap. */
  ensureConnectorSource(
    orgId: number,
    input: ConnectorSourceInput,
  ): Promise<{ sourceId: number; sourceUuid: string }>;
  /** Deletes the connector's source (and its events). A reference with no source is a no-op. */
  releaseConnectorSource(orgId: number, externalRef: string): Promise<void>;
}
