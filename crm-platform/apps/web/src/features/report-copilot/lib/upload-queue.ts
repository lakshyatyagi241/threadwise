import { ApiError } from '@/lib/api/errors';
import { checkFile, libraryErrorKind, type LibraryErrorKind } from './errors';

/** One file on its way into the library, as the screens show it. */
export interface Attempt {
  key: string;
  name: string;
  status: 'busy' | 'done' | 'failed';
  error?: LibraryErrorKind;
  /** The API's own plain-language reason, for a file it could not read. */
  detail?: string;
}

export interface UploadRun {
  files: readonly File[];
  /** Documents already in the library, and the most it holds. */
  existing: number;
  max: number;
  extensions: readonly string[];
  maxBytes: number;
  upload: (file: File) => Promise<unknown>;
  /** Called each time a file's state changes (added as busy, then done or failed). */
  onChange: (attempt: Attempt) => void;
  newKey?: () => string;
}

/**
 * Puts files in the library one after another, with the same checks the Documents panel has: the accepted extensions, the size
 * limit and the room left. A file that fails a check never leaves the browser; one that fails on the server keeps the server's code
 * and reason. A failed file does not stop the ones after it. Resolves with the number added.
 */
export async function runUploads(run: UploadRun): Promise<number> {
  let count = run.existing;
  let added = 0;
  for (const file of run.files) {
    const key = (run.newKey ?? (() => crypto.randomUUID()))();
    const check = checkFile(file, run.extensions, run.maxBytes);
    const refusal = check !== 'ok' ? check : count >= run.max ? 'full' : null;
    if (refusal) {
      run.onChange({ key, name: file.name, status: 'failed', error: refusal });
      continue;
    }
    run.onChange({ key, name: file.name, status: 'busy' });
    try {
      await run.upload(file);
      count++;
      added++;
      run.onChange({ key, name: file.name, status: 'done' });
    } catch (e) {
      run.onChange({
        key,
        name: file.name,
        status: 'failed',
        error: libraryErrorKind(e),
        ...(e instanceof ApiError ? { detail: e.message } : {}),
      });
    }
  }
  return added;
}

/** Replace the attempt with the same key, or add it at the end. */
export function upsertAttempt(list: readonly Attempt[], next: Attempt): Attempt[] {
  const at = list.findIndex((a) => a.key === next.key);
  if (at === -1) return [...list, next];
  const out = list.slice();
  out[at] = next;
  return out;
}
