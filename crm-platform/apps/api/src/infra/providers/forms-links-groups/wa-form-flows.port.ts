import type { WabaConnection } from '../whatsapp-cloud-api-waba/waba-admin.port';

export const WA_FORM_FLOWS = Symbol('WA_FORM_FLOWS');

/** One Flow as Meta lists it; `status` is Meta's own word (DRAFT, PUBLISHED, DEPRECATED, BLOCKED, THROTTLED). */
export interface MetaFlowSummary {
  id: string;
  name: string;
  status: string;
}

export interface FlowAssetValidationError {
  error: string;
  message: string;
  line?: number;
}

/**
 * Meta Graph adapter for the piece of the Flows API WhatsApp Forms needs: create-if-missing, upload the Flow JSON
 * asset, publish. Written against the port so it is replaceable in tests (TW-WFL-004) — nothing here has run
 * against a real Meta Business Account (no Official account to test with in this environment); tests drive it
 * through a fake.
 */
export interface WaFormFlowsPort {
  /** Idempotent: returns the existing id unchanged when one is already minted (re-publish picks up where it left off). */
  ensureFlow(
    conn: WabaConnection,
    existingFlowId: string | null,
    input: { name: string; categories: string[] },
  ): Promise<{ flowId: string }>;

  /** Uploads `flow.json` as the flow's asset; returns Meta's `validation_errors`, if any (publish is refused until empty). */
  uploadFlowJson(
    conn: WabaConnection,
    flowId: string,
    flowJson: object,
  ): Promise<{ validationErrors: FlowAssetValidationError[] }>;

  publish(conn: WabaConnection, flowId: string): Promise<void>;

  /** Meta's web preview of the flow as last uploaded (a draft works), so it can be tried before it is published; null when Meta gives none. */
  previewUrl(conn: WabaConnection, flowId: string): Promise<string | null>;

  /** Every Flow of the connection's WhatsApp Business Account (all pages). */
  listFlows(conn: WabaConnection): Promise<MetaFlowSummary[]>;
}
