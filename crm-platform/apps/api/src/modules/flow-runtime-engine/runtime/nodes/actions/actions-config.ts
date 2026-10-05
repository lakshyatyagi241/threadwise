import type { LastOut, OutboundMessage } from '../../types';

/**
 * What the editor saves for the five action nodes, read into the shape the executor uses (pure: no I/O, so it is unit-tested). The
 * editor's `data` keys are WaDesk's: tag `{action, tagId, tag}`, assign `{team, userId, message}`, deal `{action, dealName, stageId,
 * value, ownerId, saveAs}`, notify `{copyNumber, source, kind, text, url, caption, filename}`, Instagram `{igUsername, introText}`.
 */
type Bag = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tagConfig(d: Bag): { action: 'add' | 'remove'; tagId: string; name: string } {
  return {
    action: str(d.action).toLowerCase() === 'remove' ? 'remove' : 'add',
    tagId: str(d.tagId).trim(),
    name: str(d.tag).trim(),
  };
}

export function assignConfig(
  d: Bag,
  render: (t: unknown) => string,
): { teamId: string; userId: string; note: string } {
  return {
    teamId: str(d.team ?? d.teamId).trim(),
    userId: str(d.userId).trim(),
    note: render(d.message ?? d.noteForAgent).trim(),
  };
}

export const DEFAULT_DEAL_NAME = '{{contact_name}} — deal';

export function dealConfig(
  d: Bag,
  render: (t: unknown) => string,
  vars: Record<string, unknown>,
): {
  action: 'create' | 'move';
  stageId: string;
  title: string;
  value: string;
  ownerId: string;
  saveAs: string;
} {
  const rawName = str(d.dealName) || DEFAULT_DEAL_NAME;
  // WaDesk's seeded variable is `contact_name`; ours is `name`. An author's own `contact_name` still wins.
  const name =
    vars.contact_name === undefined
      ? rawName.replace(/\{\{\s*contact_name\s*\}\}/gi, '{{name}}')
      : rawName;
  // The value may carry {{vars}}; only digits and a dot survive, and a second dot ends the number (parseFloat's reading).
  const kept = render(d.value).replace(/[^0-9.]/g, '');
  const num = kept === '' ? Number.NaN : Number.parseFloat(kept);
  return {
    action: str(d.action).toLowerCase() === 'move' ? 'move' : 'create',
    stageId: str(d.stageId).trim(),
    title: render(name).trim().slice(0, 191) || 'New deal',
    value: Number.isFinite(num) ? String(num) : '0',
    ownerId: str(d.ownerId).trim(),
    saveAs: str(d.saveAs).replace(/[{}\s@]/g, '') || 'deal_id',
  };
}

/** What a Copy-to-number node sends, or why it sends nothing (the flow moves on either way). */
export type NotifyPlan =
  { send: true; to: string; message: OutboundMessage } | { send: false; why: string };

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

export function notifyPlan(
  d: Bag,
  last: LastOut | null,
  render: (t: unknown) => string,
): NotifyPlan {
  // The number is personalised first (`{{agent_number}}`), then reduced to digits.
  const to = render(d.copyNumber).replace(/\D+/g, '');
  if (to === '') return { send: false, why: 'no valid number to copy to' };

  const mirror = str(d.source || 'mirror').toLowerCase() !== 'custom';
  let kind: string;
  let text: string;
  let url: string;
  let caption: string;
  let filename: string;
  if (mirror) {
    if (!last || (!last.text && !last.url)) {
      return { send: false, why: 'nothing has been sent yet to copy' };
    }
    kind = last.kind || 'text';
    text = last.text;
    url = last.url;
    caption = last.caption;
    filename = last.filename ?? '';
  } else {
    kind = str(d.kind ?? d.mediaKind ?? 'text').toLowerCase() || 'text';
    text = render(d.text);
    url = render(d.url ?? d.mediaUrl);
    caption = render(d.caption);
    filename = str(d.filename);
  }

  if (kind === 'text') {
    if (text.trim() === '') return { send: false, why: 'the message to copy is empty' };
    return { send: true, to, message: { kind: 'text', body: text } };
  }
  if (url === '') return { send: false, why: `a ${kind} copy has no file link` };
  const mediaKind = MEDIA_KINDS.find((k) => k === kind) ?? 'document';
  return {
    send: true,
    to,
    message: {
      kind: 'media',
      mediaKind,
      url,
      ...(caption && mediaKind !== 'audio' ? { caption } : {}),
      ...(filename ? { filename } : {}),
    },
  };
}

export const DEFAULT_INSTAGRAM_INTRO = 'Continue with us on Instagram';

/** The link message of the WhatsApp-to-Instagram node, or null when no username was set. */
export function instagramMessage(d: Bag, render: (t: unknown) => string): string | null {
  const user = str(d.igUsername).trim().replace(/^@+/, '').trim();
  if (user === '') return null;
  const link = `https://ig.me/m/${encodeURIComponent(user)}`;
  const intro = render(d.introText === undefined ? DEFAULT_INSTAGRAM_INTRO : d.introText).trim();
  return intro ? `${intro}\n${link}` : link;
}
