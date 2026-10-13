import {
  MAIL_ATTACHMENTS_MAX_COUNT,
  MAIL_ATTACHMENTS_TOTAL_MAX_BYTES,
  MAIL_ATTACHMENT_MAX_BYTES,
} from '@crm/contracts';

/**
 * The files of the reply being written (TW-MAIL-027): each is uploaded as soon as it is added and sent by id with the reply. This
 * is the pure part: what may be added, and the state of every file as it uploads. The caps are the contract's; the server checks again.
 */

export type StagedStatus = 'uploading' | 'ready' | 'failed';

export interface StagedFile {
  /** Local key (stable while the file is on screen). */
  key: string;
  name: string;
  size: number;
  mime: string;
  status: StagedStatus;
  /** 0..100 while uploading. */
  progress: number;
  /** The id the reply names, once the server holds the file. */
  id: string | null;
  /** An API error code (or `NETWORK`) when `failed`. */
  error: string | null;
  /** Kept so Retry does not ask the person to choose the file again. */
  file: File | null;
}

/** Extensions an email must never carry: refused here with a clear reason before the upload (the server refuses them too). */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'dll',
  'jar',
  'vbs',
  'ps1',
  'apk',
  'app',
  'pif',
  'lnk',
]);

export type RefusalReason = 'empty' | 'tooLarge' | 'tooMany' | 'totalTooLarge' | 'blocked';

export interface Refusal {
  name: string;
  reason: RefusalReason;
}

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/** The sum of the sizes of the files that count (those uploading or ready, not the failed ones). */
export const totalBytes = (files: readonly StagedFile[]): number =>
  files.filter((f) => f.status !== 'failed').reduce((sum, f) => sum + f.size, 0);

/** Splits what the person chose into the files to upload and the ones refused, in order, against what is already staged. */
export function admit(
  existing: readonly StagedFile[],
  chosen: readonly File[],
): { accepted: File[]; refused: Refusal[] } {
  const accepted: File[] = [];
  const refused: Refusal[] = [];
  let count = existing.filter((f) => f.status !== 'failed').length;
  let bytes = totalBytes(existing);
  for (const f of chosen) {
    if (f.size === 0) refused.push({ name: f.name, reason: 'empty' });
    else if (BLOCKED_EXTENSIONS.has(extensionOf(f.name))) {
      refused.push({ name: f.name, reason: 'blocked' });
    } else if (f.size > MAIL_ATTACHMENT_MAX_BYTES) {
      refused.push({ name: f.name, reason: 'tooLarge' });
    } else if (count >= MAIL_ATTACHMENTS_MAX_COUNT) {
      refused.push({ name: f.name, reason: 'tooMany' });
    } else if (bytes + f.size > MAIL_ATTACHMENTS_TOTAL_MAX_BYTES) {
      refused.push({ name: f.name, reason: 'totalTooLarge' });
    } else {
      accepted.push(f);
      count += 1;
      bytes += f.size;
    }
  }
  return { accepted, refused };
}

export type StagedAction =
  | { type: 'add'; items: StagedFile[] }
  | { type: 'progress'; key: string; progress: number }
  | { type: 'uploaded'; key: string; id: string }
  | { type: 'failed'; key: string; error: string }
  | { type: 'retry'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' };

export function stagedReducer(state: StagedFile[], action: StagedAction): StagedFile[] {
  const patch = (key: string, p: Partial<StagedFile>) =>
    state.map((f) => (f.key === key ? { ...f, ...p } : f));
  switch (action.type) {
    case 'add':
      return [...state, ...action.items];
    case 'progress':
      return patch(action.key, { progress: action.progress });
    case 'uploaded':
      return patch(action.key, {
        status: 'ready',
        progress: 100,
        id: action.id,
        error: null,
        file: null,
      });
    case 'failed':
      return patch(action.key, { status: 'failed', error: action.error });
    case 'retry':
      return patch(action.key, { status: 'uploading', progress: 0, error: null });
    case 'remove':
      return state.filter((f) => f.key !== action.key);
    case 'clear':
      return [];
  }
}

export function stagedFrom(file: File, key: string): StagedFile {
  return {
    key,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    status: 'uploading',
    progress: 0,
    id: null,
    error: null,
    file,
  };
}

/** What the reply carries: the ids of the uploaded files, in the order they were added. */
export const readyIds = (files: readonly StagedFile[]): string[] =>
  files.flatMap((f) => (f.status === 'ready' && f.id ? [f.id] : []));

export const isUploading = (files: readonly StagedFile[]): boolean =>
  files.some((f) => f.status === 'uploading');

export const hasFailed = (files: readonly StagedFile[]): boolean =>
  files.some((f) => f.status === 'failed');
