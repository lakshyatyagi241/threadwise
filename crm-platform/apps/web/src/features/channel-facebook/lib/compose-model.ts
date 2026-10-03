import type { CreateFbPostInput } from '@crm/contracts';

/** The post composer's state and what it sends (TW-FB-016). Pure, so the rules can be tested without a screen. */

export const POST_TYPES = ['photo', 'multi_photo', 'link', 'video', 'reel'] as const;
export type ComposeType = (typeof POST_TYPES)[number];

export interface ComposeState {
  pageId: string;
  type: ComposeType;
  message: string;
  /** Image addresses, one per line or separated by commas or spaces. */
  photoText: string;
  link: string;
  videoUrl: string;
  when: 'now' | 'later';
  /** A `datetime-local` value, in the viewer's time zone. */
  scheduledLocal: string;
}

export const emptyCompose = (pageId: string): ComposeState => ({
  pageId,
  type: 'photo',
  message: '',
  photoText: '',
  link: '',
  videoUrl: '',
  when: 'now',
  scheduledLocal: '',
});

const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** The image addresses in a box: split on whitespace and commas, anything that is not a web address dropped (Reference's rule). */
export const splitUrls = (text: string): string[] =>
  text.split(/[\s,]+/).filter((s) => s !== '' && isHttpUrl(s));

/** How far a zone is from UTC at an instant, in minutes. */
function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return (asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/** A `datetime-local` value in a time zone to the instant it names; null when it does not parse. Settled in two steps across a clock change. */
export function zonedLocalToInstant(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = asUtc - offsetMinutes(tz, new Date(asUtc)) * 60_000;
  guess = asUtc - offsetMinutes(tz, new Date(guess)) * 60_000;
  return new Date(guess);
}

export type ComposeProblem = 'noPage' | 'scheduleMissing' | 'scheduleInvalid';

/**
 * What a post is sent as. Only the fields of the chosen type go: a photo post sends photos, a link post the link, a video or reel
 * the video (Reference submitted every field, so text left in a hidden box could turn a post into the "photos and a link" refusal).
 * Choosing "later" needs a time: Reference published at once when it was left empty, which is not what was asked for.
 */
export function buildCreateInput(
  s: ComposeState,
  tz: string,
): { ok: true; input: CreateFbPostInput } | { ok: false; problem: ComposeProblem } {
  if (s.pageId === '') return { ok: false, problem: 'noPage' };
  const input: CreateFbPostInput = { pageId: s.pageId };
  const message = s.message.trim();
  if (message !== '') input.message = message;
  if (s.type === 'photo' || s.type === 'multi_photo') {
    const photos = splitUrls(s.photoText);
    if (photos.length > 0) input.photoUrls = photos;
  } else if (s.type === 'link') {
    if (s.link.trim() !== '') input.link = s.link.trim();
  } else if (s.videoUrl.trim() !== '') {
    input.videoUrl = s.videoUrl.trim();
    if (s.type === 'reel') input.asReel = true;
  }
  if (s.when === 'later') {
    if (s.scheduledLocal.trim() === '') return { ok: false, problem: 'scheduleMissing' };
    const at = zonedLocalToInstant(s.scheduledLocal, tz);
    if (!at) return { ok: false, problem: 'scheduleInvalid' };
    input.scheduledAt = at.toISOString();
  }
  return { ok: true, input };
}

/** What the live preview draws under the text: photos, a link card, or a video. */
export type PreviewMedia =
  | { kind: 'none' }
  | { kind: 'photos'; photos: string[] }
  | { kind: 'link'; url: string }
  | { kind: 'video'; url: string; reel: boolean };

export function previewMedia(s: ComposeState): PreviewMedia {
  if (s.type === 'photo' || s.type === 'multi_photo') {
    const photos = splitUrls(s.photoText).slice(0, s.type === 'photo' ? 1 : 10);
    return photos.length > 0 ? { kind: 'photos', photos } : { kind: 'none' };
  }
  if (s.type === 'link')
    return s.link.trim() !== '' ? { kind: 'link', url: s.link.trim() } : { kind: 'none' };
  return s.videoUrl.trim() !== ''
    ? { kind: 'video', url: s.videoUrl.trim(), reel: s.type === 'reel' }
    : { kind: 'none' };
}

/** The submit button's label: Publish, or Schedule. */
export const submitKey = (s: ComposeState): 'publish' | 'schedule' =>
  s.when === 'later' ? 'schedule' : 'publish';
