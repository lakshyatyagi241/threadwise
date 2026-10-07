import type { WizardDraftResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { sanitizePatch } from './save-patch';
import type { DraftPatch } from './state';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export const AUTOSAVE_DELAY_MS = 800;

export interface AutosaveDeps {
  create: (patch: DraftPatch) => Promise<WizardDraftResponse>;
  update: (id: string, patch: DraftPatch, rowVersion: number) => Promise<WizardDraftResponse>;
  onStatus: (status: SaveStatus, error?: unknown) => void;
  /** Called with every saved response (the id after the first save, the new rowVersion each time). */
  onSaved: (saved: WizardDraftResponse) => void;
  delayMs?: number;
}

/**
 * Keeps ONE draft saved as the person works. The first change creates it, later changes are merged and sent after a pause
 * (`delayMs`), or at once with `flush()` (before Next, Back, a test send, the launch). It saves one request at a time with the
 * row version of the last answer. A 409 stops everything and says `conflict`: nothing is retried, because that would overwrite
 * what the other session wrote. Any other failure keeps the changes and the next change tries again.
 */
export class Autosaver {
  id: string | null;
  rowVersion: number | null;
  status: SaveStatus = 'idle';
  private pending: DraftPatch = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<boolean> | null = null;
  private readonly delay: number;

  constructor(
    private readonly deps: AutosaveDeps,
    start: { id: string; rowVersion: number } | null = null,
  ) {
    this.id = start?.id ?? null;
    this.rowVersion = start?.rowVersion ?? null;
    this.delay = deps.delayMs ?? AUTOSAVE_DELAY_MS;
  }

  /** True while there is something not saved yet (unsaved-changes protection). */
  get unsaved(): boolean {
    return (
      this.status === 'pending' ||
      this.status === 'saving' ||
      this.status === 'error' ||
      this.status === 'conflict'
    );
  }

  private set(status: SaveStatus, error?: unknown) {
    this.status = status;
    this.deps.onStatus(status, error);
  }

  change(patch: DraftPatch): void {
    if (Object.keys(patch).length === 0) return;
    this.pending = { ...this.pending, ...patch };
    if (this.status === 'conflict') return;
    if (this.status !== 'saving') this.set('pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  /** Saves what is waiting and resolves true when everything is saved (or nothing was waiting). */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight) await this.inflight;
    if (this.status === 'conflict') return false;
    if (Object.keys(this.pending).length === 0) return true;
    this.inflight = this.run();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async run(): Promise<boolean> {
    // Changes made while a request is out go in the next one, until nothing is waiting.
    while (Object.keys(this.pending).length > 0) {
      const sent = this.pending;
      this.pending = {};
      this.set('saving');
      try {
        const patch = sanitizePatch(sent);
        // Nothing the server would accept is left (half-typed values only): nothing to send.
        if (Object.keys(patch).length === 0 && this.id !== null) continue;
        const saved =
          this.id === null || this.rowVersion === null
            ? await this.deps.create(patch)
            : await this.deps.update(this.id, patch, this.rowVersion);
        this.id = saved.id;
        this.rowVersion = saved.rowVersion;
        this.deps.onSaved(saved);
      } catch (e) {
        // Put back what was not saved, without overwriting what was typed since.
        this.pending = { ...sent, ...this.pending };
        if (e instanceof ApiError && e.isRowVersionConflict) this.set('conflict', e);
        else this.set('error', e);
        return false;
      }
    }
    this.set('saved');
    return true;
  }

  /** Starts over from a saved draft (after a reload), dropping what was waiting. */
  reset(start: { id: string; rowVersion: number }): void {
    this.dispose();
    this.pending = {};
    this.id = start.id;
    this.rowVersion = start.rowVersion;
    this.set('saved');
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
