import type { WabaConnectService } from './waba-connect.service';

/**
 * The slice of the connection service the inbox uses (opening a number's decrypted credentials). A token instead of the class so the inbox
 * does not import the WABA module's files: those files reach back into the inbox through broadcasts and the node bridge, and a file
 * cycle leaves a class `undefined` while Nest reads its constructor.
 */
export const WABA_CONNECTIONS = Symbol('WABA_CONNECTIONS');
export type WabaConnectionsPort = Pick<WabaConnectService, 'resolveConnection'>;
