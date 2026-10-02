import type { TgTemplate } from '@crm/contracts';

/** What the compose screen decides without the network (TW-TG-012). Pure. */

/** The live preview shows the placeholder as "there"; `{name}` is what Reference's screen promises, `{{name}}` what its sender replaced. */
export const previewText = (body: string): string =>
  body.replace(/\{\{\s*name\s*\}\}|\{name\}/g, 'there').trim();

/** Picking a template fills the message only while it is empty, so typed text is never overwritten. */
export const bodyAfterTemplate = (body: string, template: TgTemplate | undefined): string =>
  body.trim() === '' && template ? template.body : body;

/** The labels of a template's buttons, for the preview chips. A template stores them as a list of objects. */
export function buttonLabels(buttons: unknown): string[] {
  if (!Array.isArray(buttons)) return [];
  return buttons.flatMap((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const label = o.text ?? o.label;
    return typeof label === 'string' && label.trim() !== '' ? [label.trim()] : [];
  });
}

export interface ComposeDraft {
  name: string;
  botId: string;
  body: string;
  mediaUrl: string;
  selected: ReadonlySet<string>;
}

/** The name, a bot and at least one chat are needed, plus a message or a file (the server says the same). */
export const canCreate = (d: ComposeDraft): boolean =>
  d.name.trim() !== '' &&
  d.botId !== '' &&
  d.selected.size > 0 &&
  (d.body.trim() !== '' || d.mediaUrl.trim() !== '');

export const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};
