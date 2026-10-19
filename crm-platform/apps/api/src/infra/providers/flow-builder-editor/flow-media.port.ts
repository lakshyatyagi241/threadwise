/**
 * Where a flow's uploaded media (Media and Sequence nodes) lives (TW-FLB-027). A port: object storage (S3 / R2) is
 * a platform decision that has not landed (workstream F5), so the flows module only knows this interface. The default
 * adapter writes to local disk; swapping it for object storage is one provider binding.
 */
export const FLOW_MEDIA_STORE = Symbol('FLOW_MEDIA_STORE');

export interface StoredFlowMedia {
  /** The public URL the node stores and the runtime later fetches. Absolute. */
  url: string;
}

export interface FlowMediaStore {
  /** Stores `data` for the organization under the server-generated `name`; never a client-supplied name. */
  put(orgKey: string, name: string, data: Buffer, mime: string): Promise<StoredFlowMedia>;
  /** Reads a stored file, or null when it does not exist. */
  get(orgKey: string, name: string): Promise<{ data: Buffer; mime: string } | null>;
}
