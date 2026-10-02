import type { SendVars } from '../../../infra/providers/whatsapp/meta-send-payload';

/**
 * Send-time template overrides (TW-BCAST-017 rule 9, TW-BCAST-015 rule 3): what the operator typed in the mapping panel
 * for this one broadcast. They win over the template's own variable map only for the slots that were filled in; a blank
 * slot keeps the template-driven value.
 */
export type OverrideButtonKind = 'url' | 'quick_reply' | 'copy_code';

export interface TemplateOverrides {
  header?: { mode: 'text'; text: string } | { mode: 'media'; mediaUrl: string };
  body?: string[];
  footer?: string[];
  buttons?: Array<{ index: number; subType: OverrideButtonKind; value: string }>;
}

const SLOT_MAX = 1024;
const BUTTON_MAX = 2048;
const isDict = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) =>
  typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '';

function httpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Cleans what the form posted before it is stored. Anything unrecognised is dropped rather than stored: the column is read
 * back on every send, so it must never carry a shape the resolver cannot walk. Null when nothing usable was supplied.
 */
export function sanitizeOverrides(input: unknown): TemplateOverrides | null {
  if (!isDict(input)) return null;
  const out: TemplateOverrides = {};

  const header = input.header;
  if (isDict(header)) {
    if (String(header.mode ?? 'text').toLowerCase() === 'media') {
      const url = httpUrl(str(header.mediaUrl));
      if (url) out.header = { mode: 'media', mediaUrl: url };
    } else {
      const text = str(header.text);
      if (text) out.header = { mode: 'text', text: text.slice(0, SLOT_MAX) };
    }
  }

  for (const section of ['body', 'footer'] as const) {
    const slots = input[section];
    if (!Array.isArray(slots)) continue;
    const clean = slots.map((v) => str(v).slice(0, SLOT_MAX));
    // All blank means the operator opened the panel and typed nothing.
    if (clean.join('') !== '') out[section] = clean;
  }

  if (Array.isArray(input.buttons)) {
    const clean: NonNullable<TemplateOverrides['buttons']> = [];
    for (const b of input.buttons) {
      if (!isDict(b) || b.index === undefined || b.index === null) continue;
      const value = str(b.value);
      const index = Number(b.index);
      if (value === '' || !Number.isInteger(index) || index < 0) continue;
      const sub = String(b.subType ?? 'url').toLowerCase();
      clean.push({
        index,
        subType: sub === 'quick_reply' || sub === 'copy_code' ? sub : 'url',
        value: value.slice(0, BUTTON_MAX),
      });
    }
    if (clean.length) out.buttons = clean;
  }

  return Object.keys(out).length ? out : null;
}

/** Positional overlay: override slot N replaces base slot N when something is typed there; the result is as long as the longer. */
function overlaySlots(
  base: readonly string[],
  overrides: readonly string[] | undefined,
  render: (t: string) => string,
) {
  if (!overrides || overrides.length === 0) return [...base];
  const count = Math.max(base.length, overrides.length);
  return Array.from({ length: count }, (_, i) => {
    const raw = overrides[i];
    return typeof raw === 'string' && raw.trim() !== '' ? render(raw) : (base[i] ?? '');
  });
}

export interface AppliedVars extends SendVars {
  footer?: string[];
}

/**
 * Overlays the overrides on the variables the template produced. `render` resolves the `{{tokens}}` an operator typed
 * against this recipient. Returns the button indexes the template does not take a parameter for (Meta rejects a parameter
 * for a static button, so they are dropped and the caller logs them).
 */
export function applyOverrides(
  vars: AppliedVars,
  overrides: TemplateOverrides | null | undefined,
  render: (text: string) => string,
): { vars: AppliedVars; ignoredButtons: number[] } {
  if (!overrides) return { vars, ignoredButtons: [] };
  const out: AppliedVars = { ...vars };

  if (overrides.header?.mode === 'media') {
    out.headerMediaUrl = overrides.header.mediaUrl;
    delete out.headerMediaId; // a stale id would win otherwise
  } else if (overrides.header?.mode === 'text' && overrides.header.text.trim() !== '') {
    out.header = render(overrides.header.text);
  }

  out.body = overlaySlots(vars.body ?? [], overrides.body, render);
  if (overrides.footer?.length)
    out.footer = overlaySlots(vars.footer ?? [], overrides.footer, render);

  const ignored: number[] = [];
  if (overrides.buttons?.length) {
    const byIndex = new Map<number, string>();
    for (const b of overrides.buttons) if (b.value.trim() !== '') byIndex.set(b.index, b.value);
    out.buttons = (vars.buttons ?? []).map((btn) => {
      const raw = byIndex.get(btn.index);
      if (raw === undefined) return btn;
      byIndex.delete(btn.index);
      return { ...btn, value: render(raw) };
    });
    ignored.push(...byIndex.keys());
  }
  return { vars: out, ignoredButtons: ignored };
}
