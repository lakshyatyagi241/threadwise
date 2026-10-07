/**
 * Where an uploaded knowledge file is kept (AIAG). A port: object storage is a platform decision, so the domain only knows this
 * interface. The default adapter writes to the local disk the chat media store already uses.
 *
 * The bytes are read once, at upload, to extract the text; the stored copy exists so a person's original is not lost and is deleted
 * with its entry. The key is server-made and never leaves the server.
 */
export const TRAINING_FILE_STORE = Symbol('TRAINING_FILE_STORE');

export interface TrainingFileStore {
  /** Stores `data` for the organization under a fresh server-made name and answers its key. `ext` is a validated extension. */
  put(orgId: number, ext: string, data: Buffer): Promise<string>;
  /** Copies a stored file under a fresh key (a duplicated assistant must not share a file with the original). Null when missing. */
  copy(orgId: number, key: string): Promise<string | null>;
  /** Deletes a stored file; a missing one is not an error. */
  remove(orgId: number, key: string): Promise<void>;
}
