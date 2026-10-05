import type { Tx } from '@crm/db';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';

/**
 * The slice of the connection service the inbox uses (opening a number's decrypted credentials), as a leaf file: a token and types.
 * A token instead of the class so the inbox does not import the WABA module's files: those files reach back into the inbox through
 * broadcasts and the node bridge, and a file cycle leaves a class `undefined` while Nest reads its constructor.
 */
export const WABA_CONNECTIONS = Symbol('WABA_CONNECTIONS');

/** What `resolveConnection` returns. */
export interface ResolvedWabaConnection {
  id: number;
  uuid: string;
  status: string;
  label: string | null;
  /** The number as people write it (`wa_provider_configs.phone_number`). */
  phoneNumber: string | null;
  /** From `meta_json`; set even when `conn` is null (no usable credentials), so another domain can still identify the number. */
  wabaId: string | null;
  phoneNumberId: string | null;
  conn: WabaConnection | null;
}

export interface WabaConnectionsPort {
  resolveConnection(
    tx: Tx,
    orgId: number,
    ref: { uuid: string } | { id: number },
  ): Promise<ResolvedWabaConnection | null>;
}
