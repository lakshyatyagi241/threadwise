import type { Tx } from '@crm/db';

/** The number a broadcast is sent from, resolved at dispatch time (TW-BCAST-016). */
export interface DispatchSender {
  engine: string;
  /** Internal id in the engine's own table. */
  id: number;
  /** The sender's own number as digits; empty means it cannot be used. */
  phoneDigits: string;
  label: string;
}

export interface ResolvedSender {
  /** `<engine>:<uuid>`, the key the client sent. */
  key: string;
  /** Internal id in the engine's own table (devices for baileys, wa_provider_configs otherwise). */
  id: number;
  engine: string;
  label: string;
}

/** Resolves picked sender keys against the numbers this organization can send through right now. */
export interface SenderDirectory {
  /** Unknown, stale or disconnected keys are dropped, never errors (Reference rule). De-duplicated by key. */
  resolve(tx: Tx, orgId: number, keys: readonly string[]): Promise<ResolvedSender[]>;
  /** Engine a sender-less broadcast falls back to. */
  defaultEngine(tx: Tx, orgId: number): Promise<string>;
  /**
   * The sender a stored broadcast sends from (TW-BCAST-016 rules 2 and 3): the row it names, else the organization's primary
   * connected config of that provider (waba, twilio) or its newest connected device (baileys). Null when there is none.
   */
  resolveForDispatch(
    tx: Tx,
    orgId: number,
    broadcast: { provider: string | null; deviceId: number | null },
  ): Promise<DispatchSender | null>;
}
export const SENDER_DIRECTORY = Symbol('BROADCAST_SENDER_DIRECTORY');

export interface TemplateRecord {
  id: number;
  uuid: string;
  templateName: string;
  language: string;
  templateBody: string;
  header: string | null;
  footer: string | null;
  headerLocation: unknown;
  parameterFormat: string | null;
  variableMap: unknown;
  buttons: unknown;
  carouselData: unknown;
  templateType: string;
  attachmentType: string | null;
  attachmentFile: string | null;
  metaTemplateId: string | null;
  metaStatus: string | null;
  pausedUntil: Date | null;
  qualityScore: string | null;
}

export interface TemplateDirectory {
  /** Scoped to the organization: another tenant's template is simply not found. */
  find(tx: Tx, orgId: number, uuid: string): Promise<TemplateRecord | undefined>;
  findById(tx: Tx, orgId: number, id: number): Promise<TemplateRecord | undefined>;
  /** Public URL of stored media; null when the storage layer cannot say (the media check is then skipped). */
  mediaUrl(path: string): string | null;
  /** The platform switch `waba_templates_v2_enabled`. */
  wabaTemplatesV2Enabled(tx: Tx): Promise<boolean>;
}
export const TEMPLATE_DIRECTORY = Symbol('BROADCAST_TEMPLATE_DIRECTORY');

export interface WalletGate {
  /**
   * The launch precheck (TW-WALLET-013): throws 422 `WALLET_EMPTY` when the wallet cannot cover `count` messages. Passes for
   * platform-owned workspaces and for plan-quota workspaces still inside their free monthly messages. Called before any row exists.
   */
  precheck(orgId: number, count: number, opts?: WalletGateOptions): Promise<void>;
  /**
   * The per-recipient check of a running send: throws 422 `WALLET_EMPTY` when the wallet cannot pay for this one message, so a run
   * (or several started on the same balance) stops once the money is spent. Same exemptions as `precheck`; a free message passes.
   */
  precheckSend(orgId: number, to: string, opts?: Omit<WalletGateOptions, 'phones'>): Promise<void>;
}
export interface WalletGateOptions {
  /** What is launching, for the wallet log. Defaults to `broadcast`. */
  source?: 'broadcast' | 'campaign' | 'scheduled';
  /** The recipients' numbers when known, so the estimate follows each country's price. */
  phones?: readonly string[];
  category?: string | null;
}
export const WALLET_GATE = Symbol('BROADCAST_WALLET_GATE');

export interface WarmerSlice {
  sender: ResolvedSender;
  recipients: number;
}
export interface WarmerGate {
  /** A warming number's own gap between messages, in seconds; null when the number is not warming. */
  gap(
    tx: Tx,
    sender: ResolvedSender | DispatchSender,
  ): Promise<{ min: number; max: number } | null>;
  /** Reasons a warming number must hold this send; empty means go. Passing slices are reserved. */
  hold(
    tx: Tx,
    slices: readonly WarmerSlice[],
    opts: { isNow: boolean; sendDate: string | null },
  ): Promise<string[]>;
}
export const WARMER_GATE = Symbol('BROADCAST_WARMER_GATE');

export interface BroadcastPlanGate {
  /** The `broadcast` plan flag (default off in Reference). */
  assertEnabled(orgId: number): Promise<void>;
}
export const BROADCAST_PLAN_GATE = Symbol('BROADCAST_PLAN_GATE');
