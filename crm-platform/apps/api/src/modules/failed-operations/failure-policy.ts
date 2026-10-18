import { QUEUES, type QueueName } from '../../infra/queue/queues';

/**
 * Which queues write a durable failed-operation record, and how each one may be redriven.
 *
 * Only queues where the job is the ONLY copy of work the provider already got our 200 for belong here. A queue whose state lives in
 * a table (a broadcast recipient, an outbound message, an export, a delivery log) records its own failure and is not listed; a queue
 * that can be re-read from its source (a sync) loses nothing by failing. The inventory is `docs/quality/dlq-strategy.md`.
 */
export const POLICY_VERSION = 'dlq-policy-1';

export interface QueueFailurePolicy {
  queue: QueueName;
  priority: 'P0' | 'P1';
  /** Redrives allowed before the record escalates to a person (a finite loop: a poison payload cannot cycle forever). */
  maxReplays: number;
  /** Minimum time between two redrives of one record. */
  cooldownMs: number;
  /** A record older than this is not redriven: the event is stale and a replay could act on state that moved on. */
  maxAgeMs: number;
  /** The consumer deduplicates (a ledger key), so running a half-done operation again is safe. */
  ambiguousReplaySafe: boolean;
  /** Version of the job payload shape the record was captured with. A redrive of an older version is blocked until a migration exists. */
  payloadSchemaVersion: number;
  /** The workspace the job belongs to, when the payload names it; null when the worker finds it later (a WhatsApp number). */
  orgOf(data: unknown): number | null;
}

const DAY = 24 * 3600 * 1000;

function orgField(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const v = (data as { orgId?: unknown }).orgId;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

const base = { maxReplays: 3, cooldownMs: 60_000, maxAgeMs: 30 * DAY, payloadSchemaVersion: 1 };

export const FAILURE_POLICIES: ReadonlyArray<QueueFailurePolicy> = [
  // Inbound message and receipt of every channel; ledger-deduplicated.
  {
    ...base,
    queue: QUEUES.WEBHOOK_INGEST,
    priority: 'P0',
    ambiguousReplaySafe: true,
    orgOf: orgField,
  },
  // WhatsApp webhook payload (sealed); the workspace is routed from the phone number when it is worked.
  {
    ...base,
    queue: QUEUES.WABA_INGEST,
    priority: 'P0',
    ambiguousReplaySafe: true,
    orgOf: () => null,
  },
  // Channel event that could not be stored (sealed); the handler resolves the workspace.
  {
    ...base,
    queue: QUEUES.WEBHOOK_RETRY,
    priority: 'P0',
    ambiguousReplaySafe: true,
    orgOf: () => null,
  },
  // Store webhook / cart step / broadcast step.
  {
    ...base,
    queue: QUEUES.ECOM_WEBHOOK,
    priority: 'P1',
    ambiguousReplaySafe: true,
    orgOf: orgField,
  },
  // Finished-call callback.
  {
    ...base,
    queue: QUEUES.TELEPHONY_INGEST,
    priority: 'P1',
    ambiguousReplaySafe: true,
    orgOf: orgField,
  },
];

export const POLICY_BY_QUEUE: ReadonlyMap<string, QueueFailurePolicy> = new Map(
  FAILURE_POLICIES.map((p) => [p.queue, p]),
);

/** A replay is added under this id so its outcome maps back to the record: `dlq-<record uuid>-<replay number>`. */
export const replayJobId = (recordUuid: string, replay: number): string =>
  `dlq-${recordUuid}-${replay}`;

const REPLAY_ID = /^dlq-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)$/;

export function parseReplayJobId(
  jobId: string | undefined,
): { uuid: string; replay: number } | null {
  const m = jobId ? REPLAY_ID.exec(jobId) : null;
  return m ? { uuid: m[1]!, replay: Number(m[2]) } : null;
}
