import type { Handler } from '../registry';
import type { Doc } from '../util';

export type Row = Record<string, unknown>;

/** A problem with one field of an otherwise migratable document. Recorded in quarantine, the document still loads. */
export interface Soft {
  code: string;
  reason: string;
  detail?: unknown;
}

export type Outcome =
  | { kind: 'rows'; rows: Array<{ table: string; sub: string; row: Row }>; soft?: Soft[] }
  /** The document maps onto a row that already exists (the owner user, a preset role): id_map points at it, nothing is inserted. */
  | {
      kind: 'adopt';
      table: 'users' | 'roles' | 'flows' | 'chatbot_widgets';
      column: 'email' | 'system_key' | 'uuid';
      value: string;
      soft?: Soft[];
    }
  | { kind: 'exclude'; code: string; reason: string }
  | { kind: 'quarantine'; code: string; reason: string; detail?: unknown };

export type AdoptOutcome = Extract<Outcome, { kind: 'adopt' }>;

export interface ColSpec {
  name: string;
  /** Postgres type used to read the column out of a jsonb_to_recordset batch. */
  pg:
    | 'text'
    | 'bigint'
    | 'integer'
    | 'boolean'
    | 'timestamptz'
    | 'jsonb'
    | 'citext'
    | 'smallint'
    | 'perm_effect'
    | 'record_scope'
    | 'date'
    | 'time'
    | 'numeric';
}

export interface TableSpec {
  columns: ColSpec[];
  /** Kept for readability of the specs; the verifier compares EVERY column in `columns`, not just these. */
  fp?: string[];
  /** Columns the verifier does not compare row by row (checked by a dedicated rule instead, e.g. display_id). */
  skipCompare?: string[];
  /** Columns the loader never writes and so must still hold this value in the target (defaults, row_version = 1). */
  constants?: Record<string, unknown>;
  /**
   * A table with no uuid column (role_grants, user_roles, user_profiles, user_security): rows are inserted after the parent row of the
   * same document, `parentCol` is filled with the parent's new id, and a conflict on the primary key is skipped. Idempotency comes
   * from the parent: a document whose parent is already in id_map is never re-read.
   */
  keyless?: { parent: string; parentCol: string };
  /**
   * A partitioned table (messages): the id lookups after an insert also filter on this timestamp column, bounded by the batch's own
   * rows, so only the partitions that can hold them are read.
   */
  windowCol?: string;
  /** Columns the live application changes once it takes writes (delivery receipts, stars ...): not compared under --allow-extra-rows. */
  liveColumns?: string[];
  /**
   * A table with no uuid column and no unique key (ai_token_usage, usage_charges: both partitioned): the loader inserts the batch itself and
   * returns the id of every row it wrote, by the row's deterministic uuid (which then only lives in migration.id_map). A row it does not
   * return is quarantined UNIQUE_CONFLICT. The verifier does not compare such a table generically: its own verifier does.
   */
  custom?: (
    tx: import('../load/db').TenantTx,
    orgId: number,
    items: Array<{ uuid: string; row: Row }>,
  ) => Promise<{ ids: Map<string, number>; inserted: number }>;
  /** Set on the spec (not installed by the loader) so the verifier knows the table has no uuid column. */
  noUuid?: boolean;
}

/** source key -> where it goes. 'drop:' entries are the explicit dropped-fields list and carry their reason. */
export type FieldMap = Record<string, string>;

export interface TargetRef {
  id: number;
  uuid: string;
  table: string;
}

/** What a transform may look at: the source index and ids already loaded (resolved through migration.id_map). */
export interface Ctx {
  client: string;
  orgId: number;
  defaultCountryCode: string | null;
  /** Stand-in timestamp for a document with no usable date at all: the dump manifest's generatedAt, so reruns agree. */
  fallbackAt: string;
  ref(collection: string, key: unknown): TargetRef | undefined;
  /** Roles and users steps only: the reviewed maps, the target's permission catalogue and the cross-document plans. */
  access?: import('./access-plan').AccessCtx;
  idx: import('./source-index').SourceIndex;
  /** Inbox step only: the plan of pass 1 (threads, seq, counters, per-document verdicts). */
  chat?: import('../inbox/plan').ChatPlan;
  /** Broadcast steps only: the campaign verdicts, the counters per campaign and the contacts by phone (pass 1). */
  bcast?: import('../broadcast/plan').BroadcastPlan;
  /** Credits steps only: the plan of pass 1 (settings, every wallet posting with its balance_after, the billing-log verdicts). */
  credits?: import('../credits/plan').CreditsPlan;
  /** Flow and widget steps only: the plan of pass 1 (which bot becomes which flow, widget and keyword reply; where every document goes). */
  flows?: import('../flows/plan').FlowPlan;
}

export interface HandlerSpec {
  handler: Handler | 'field_undeclared' | 'lifecycle_status';
  /** Extra fields that identify a document besides `_id` and `id` (users: `user_id`); each is registered in id_map. */
  aliasKeys?: string[];
  /** The registry collection this step reads. */
  collection: string;
  /** The name used in id_map for this step's documents; differs from `collection` for derived (virtual) steps. */
  mapCollection: string;
  /** Rows come from derived documents rather than from the file (their count is reported separately). */
  virtual?: boolean;
  tables: Record<string, TableSpec>;
  only?(doc: Doc): boolean;
  /** Override the document stream (derived steps). */
  read?(a: {
    idx: import('./source-index').SourceIndex;
    source: import('../extract/source').Source;
    client: string;
    /** the context of the run (plans of pass 1); derived steps read their documents from the plan */
    ctx?: Ctx;
  }): AsyncIterable<Doc> | Iterable<Doc>;
  /** Other collections whose content decides this step's documents: their hashes join the done-detection of the step (derived steps). */
  shaCollections?: string[];
  transform(doc: Doc, ctx: Ctx): Outcome;
  fields: FieldMap;
  /** Keys not in `fields` are expected (custom properties) and must each have a `fields` row in the target. */
  dynamic?: boolean;
  /** Called with the rows about to be inserted into `table`, to allocate display ids and the like. */
  beforeInsert?(
    tx: import('../load/db').TenantTx,
    ctx: Ctx,
    table: string,
    rows: Row[],
  ): Promise<void>;
  /** Called after `table`'s rows were inserted (and their ids read back), in the same transaction: ledger rows and the like. */
  afterInsert?(
    tx: import('../load/db').TenantTx,
    ctx: Ctx,
    table: string,
    rows: Array<{ uuid: string; row: Row; id: number | undefined }>,
  ): Promise<void>;
  /** Called once before the step's first batch (not when the step is already done): channels, partitions, the plan. May set env.chat. */
  prepare?(env: import('../load/engine').Env): Promise<void>;
  /** The order the loader reads documents in (the verifier always reads file order). */
  loadOrder?(env: import('../load/engine').Env): AsyncIterable<Doc>;
  /** Documents of one group are never split across two transactions: a batch only closes between groups. */
  group?(doc: Doc, env: import('../load/engine').Env): string;
  /** Mixed into the checkpoint hash: a plan that changed since the last run must not resume at a stale position. */
  fingerprint?(env: import('../load/engine').Env): string;
  /** Keys not in `fields` are carried in the row (messages.meta.legacy.extra) instead of being an alarm. */
  extraKeysStored?: boolean;
  /**
   * Opt in to UPDATE MODE (`update` command, load/update.ts): rows already in id_map are compared column by column with the transform
   * output and only the changed columns are written (never when the row was edited in WaDesk since: CONFLICT_LOCAL_EDIT).
   * `ignore`: columns update mode never touches. `prune`: a document that vanished from the source is DELETED from the target when this
   * says so (link rows only, e.g. a list membership); every other vanished document is only reported.
   */
  update?: {
    ignore?: string[];
    prune?: (sourceKey: string, env: import('../load/engine').Env) => boolean;
    /** column -> the only values update mode may write (a changed row whose new value is outside the list is refused, not written). */
    allow?: Record<string, string[]>;
  };
}
