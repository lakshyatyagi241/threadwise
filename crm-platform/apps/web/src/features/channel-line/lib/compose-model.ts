import type { LineTemplate } from '@crm/contracts';

/** What the compose screen decides without the network. Pure. */

/** The live preview shows the placeholder as "there"; `{name}` is what Reference's screen promises, `{{name}}` what its sender replaced. */
export const previewText = (body: string): string =>
  body.replace(/\{\{\s*name\s*\}\}|\{name\}/g, 'there').trim();

/** Picking a template fills the message only while it is empty, so typed text is never overwritten. */
export const bodyAfterTemplate = (body: string, template: LineTemplate | undefined): string =>
  body.trim() === '' && template ? template.body : body;

export interface ButtonChip {
  label: string;
  /** A link button (shown highlighted); anything else is a quick reply. */
  link: boolean;
}

/** The buttons of a template, for the preview chips: a template stores them as a list of objects. */
export function buttonChips(buttons: unknown): ButtonChip[] {
  if (!Array.isArray(buttons)) return [];
  return buttons.flatMap((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const label = o.text ?? o.title ?? o.label;
    if (typeof label !== 'string' || label.trim() === '') return [];
    const type = typeof o.type === 'string' ? o.type.toLowerCase() : '';
    return [{ label: label.trim(), link: type === 'url' || type === 'quick_reply_url' }];
  });
}

export interface ComposeDraft {
  name: string;
  channelId: string;
  body: string;
  mediaUrl: string;
  selected: ReadonlySet<string>;
}

/** The name, a channel and at least one person are needed, plus a message or a file (the server says the same). */
export const canCreate = (d: ComposeDraft): boolean =>
  d.name.trim() !== '' &&
  d.channelId !== '' &&
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

/** What the people ticked for a channel become: ticks are kept per channel so a stale tick never reaches another channel. */
export function toggled(selected: ReadonlySet<string>, userId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(userId)) next.delete(userId);
  else next.add(userId);
  return next;
}
