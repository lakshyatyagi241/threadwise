/**
 * How a lead source that can be PULLED (asked for its leads, instead of waiting for them) offers "Sync now" and a backfill to the lead
 * inbox (BL-014, spec L-18). A third leaf port next to `lead-ingest.port.ts` and `lead-source-directory.port.ts`, with the same rule:
 * it imports nothing, so the domain that owns the source (the marketplace for a portal connector, later the Meta lead ads door) imports
 * only this file and never a class of the leads module (that would close a module cycle: those domains already call the lead pipeline).
 *
 * The leads module owns the schedule, the limits and the record (`lead_sync_runs`): who asked, one run at a time per source, the rate
 * limit, the worker job, progress, audit. A provider owns only what is specific to its source: whether it can pull this source, what its
 * own limits are, and the pull itself. The provider hands every lead to the lead pipeline (`LEAD_INGEST`), whose idempotency key makes a
 * lead fetched twice a no-op, so a sync or a backfill can overlap what was already received without writing anything twice.
 *
 * The provider registers itself in the registry the leads module provides under `LEAD_PULL_REGISTRY`, found lazily by token in the
 * whole application (like the marketplace finds `LEAD_INGEST`), so neither module imports the other.
 */
export const LEAD_PULL_REGISTRY = Symbol('LEAD_PULL_REGISTRY');

/** The part of a lead source a provider may look at. */
export interface LeadPullSource {
  /** Internal id and uuid of the lead source. */
  id: number;
  uuid: string;
  kind: string;
  providerKey: string | null;
  /** A connector's own reference (the marketplace installation's uuid). */
  externalRef: string | null;
}

export interface LeadPullCapabilities {
  /** "Sync now" works: fetch what is new since the last poll. */
  sync: boolean;
  /** A backfill of a date range works. */
  backfill: boolean;
  /** The source's own limit: no two requests sooner than this many seconds. */
  minIntervalSeconds: number;
  /** How far back a backfill may reach, in seconds; 0 when it cannot backfill. */
  maxBackfillSeconds: number;
}

export interface LeadPullProgress {
  fetched: number;
  accepted: number;
  duplicates: number;
  failed: number;
  windowsDone: number;
  windowsTotal: number;
}

export interface LeadPullRequest {
  orgId: number;
  source: LeadPullSource;
  mode: 'sync' | 'backfill';
  /** A backfill's range (UTC). Null for a sync. */
  from: Date | null;
  to: Date | null;
  /** Reports progress. Cheap to call often: the leads module decides how often it writes. */
  progress(p: LeadPullProgress): Promise<void>;
}

export interface LeadPullResult {
  /**
   * ok: everything asked for was fetched and handed over. partial: stopped early, or some leads were not handed over; running again
   * completes it. throttled: the source's limit said not yet; nothing was asked. failed: the source refused or failed.
   */
  status: 'ok' | 'partial' | 'throttled' | 'failed';
  /** A stable code for anything but `ok` (`too_soon`, `credentials_refused`, `provider_error`, `range_too_old`...). Never provider text. */
  error?: string;
  progress: LeadPullProgress;
}

export interface LeadPullProvider {
  readonly name: string;
  /** What this provider can do for this source, or null when the source is not one of its. Reads the database in the caller's workspace. */
  capabilities(orgId: number, source: LeadPullSource): Promise<LeadPullCapabilities | null>;
  /** The pull itself, in the worker. Throwing is a bug; a refusal by the source is a `failed` or `throttled` result. */
  pull(request: LeadPullRequest): Promise<LeadPullResult>;
}

export interface LeadPullRegistryPort {
  register(provider: LeadPullProvider): void;
}
