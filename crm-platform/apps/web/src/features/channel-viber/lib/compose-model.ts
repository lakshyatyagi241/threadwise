import {
  mediaExtension,
  VIB_MEDIA_EXTENSIONS,
  VIB_MEDIA_MAX_BYTES,
  type VibTemplate,
} from '@crm/contracts';

/** What the compose screen decides without the network (TW-VIB-012). Pure. */

/** Picking a template fills the message only while it is empty, so typed text is never overwritten (Reference). */
export const bodyAfterTemplate = (body: string, template: VibTemplate | undefined): string =>
  body.trim() === '' && template ? template.body : body;

/** How many buttons a template brings, for its entry in the picker. A template stores them as a list of objects. */
export function buttonCount(buttons: unknown): number {
  if (!Array.isArray(buttons)) return 0;
  return buttons.filter((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    const label = o.text ?? o.title ?? o.label;
    return typeof label === 'string' && label.trim() !== '';
  }).length;
}

export const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Reference accepted a jpg, png, gif or mp4; a blank address is "no attachment". */
export const isAllowedMedia = (v: string): boolean =>
  v.trim() === '' ||
  (isHttpUrl(v.trim()) &&
    (VIB_MEDIA_EXTENSIONS as readonly string[]).includes(mediaExtension(v.trim())));

export const isMediaSizeOk = (bytes: number | undefined): boolean =>
  bytes === undefined || bytes <= VIB_MEDIA_MAX_BYTES;

export interface ComposeDraft {
  name: string;
  channelId: string;
  body: string;
  mediaUrl: string;
  selected: ReadonlySet<string>;
}

/** The name, a channel and at least one user are needed, plus a message or a file (the server says the same). */
export const canCreate = (d: ComposeDraft): boolean =>
  d.name.trim() !== '' &&
  d.channelId !== '' &&
  d.selected.size > 0 &&
  (d.body.trim() !== '' || d.mediaUrl.trim() !== '') &&
  isAllowedMedia(d.mediaUrl);
