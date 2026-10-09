import type { TplLintIssue } from '@crm/contracts';

/**
 * What a save has to tell the detail page it redirects to: Meta's refusal and the lint warnings (WaDesk flashes them in the
 * session). Kept in `sessionStorage` for one read, so a reload does not repeat them. Storage may be blocked: then the page
 * simply has nothing to show, and the template's own status says where it stands.
 */
export interface SaveFlash {
  metaError: string | null;
  warnings: TplLintIssue[];
}

const key = (id: string) => `tpl-flash:${id}`;

export function setFlash(id: string, flash: SaveFlash): void {
  try {
    sessionStorage.setItem(key(id), JSON.stringify(flash));
  } catch {
    /* storage unavailable */
  }
}

/** Reads the flash without consuming it (a render may run twice); `clearFlash` consumes it once the page has shown it. */
export function peekFlash(id: string): SaveFlash | null {
  try {
    const raw = sessionStorage.getItem(key(id));
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<SaveFlash>;
    return {
      metaError: typeof v.metaError === 'string' ? v.metaError : null,
      warnings: Array.isArray(v.warnings) ? v.warnings : [],
    };
  } catch {
    return null;
  }
}

export function clearFlash(id: string): void {
  try {
    sessionStorage.removeItem(key(id));
  } catch {
    /* storage unavailable */
  }
}
