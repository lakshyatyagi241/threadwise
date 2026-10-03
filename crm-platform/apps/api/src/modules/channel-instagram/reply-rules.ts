import type { BridgeReply } from '../../infra/providers/channel-instagram/instagram-bridge.port';

/** Pure rules of replying on an Instagram thread (TW-IG-010): how a message is shaped for the engine, and how a failure is worded. */

/** Instagram takes at most 13 quick-reply chips, or a button card of at most 3 buttons. */
export const QUICK_REPLY_MAX = 13;
export const BUTTON_MAX = 3;

/** The engine's conversation id from a thread key (`ig:<id>`); a key without the prefix is used as it is. */
export const engineThreadId = (rawJid: string | null): string =>
  rawJid === null ? '' : rawJid.startsWith('ig:') ? rawJid.slice(3) : rawJid;

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/**
 * What goes to the engine. A media message sends its media type (image unless the inbox said otherwise) with a public address.
 * Otherwise the template's buttons choose ONE shape: any link button makes a generic button card (link and postback buttons, at
 * most 3), else the plain buttons become quick-reply chips (at most 13). A button needs a label; a link needs an address, and a
 * link button with none is sent as a plain one. The text is left out when empty.
 */
export function shapeReply(m: {
  text: string;
  media?: { type: string | null; url: string } | null;
  buttons?: readonly unknown[];
}): BridgeReply {
  let type = 'text';
  let mediaUrl: string | null = null;
  if (m.media) {
    mediaUrl = m.media.url;
    type = m.media.type || 'image';
  }

  let quickReplies: BridgeReply['quickReplies'] = [];
  let buttons: BridgeReply['buttons'] = [];
  const given = m.buttons ?? [];
  if (mediaUrl === null && given.length > 0) {
    const quick: BridgeReply['quickReplies'] = [];
    const generic: BridgeReply['buttons'] = [];
    let hasLink = false;
    for (const raw of given) {
      if (typeof raw !== 'object' || raw === null) continue;
      const b = raw as Record<string, unknown>;
      const title = str(b.text) || str(b.title);
      if (title === '') continue;
      // A per-send override (`value`) wins over the template's own address.
      const url = str(b.value) || str(b.url);
      if ((b.type === 'URL' || url !== '') && url !== '') {
        generic.push({ type: 'web_url', title, url });
        hasLink = true;
      } else {
        quick.push({ title, payload: title });
        generic.push({ type: 'postback', title, payload: title });
      }
    }
    if (hasLink && generic.length > 0) {
      type = 'buttons';
      buttons = generic.slice(0, BUTTON_MAX);
    } else if (quick.length > 0) {
      type = 'quick_replies';
      quickReplies = quick.slice(0, QUICK_REPLY_MAX);
    }
  }
  return { type, text: m.text !== '' ? m.text : null, mediaUrl, quickReplies, buttons };
}

export const noEngineThread = (brand: string): string =>
  `This Instagram thread has no ${brand} conversation id.`;

export const notConnected = (brand: string): string =>
  `Instagram is not connected — connect ${brand} in Admin → Add-ons.`;

/** The engine's own reason, so a failed send can be diagnosed: "<brand> HTTP 502: <detail>", or that it could not be reached. */
export function sendFailure(brand: string, status: number | null, error: string | null): string {
  if (status !== null) return `${brand} HTTP ${status}: ${error ?? 'no details'}`;
  return error ?? `Could not reach ${brand}.`;
}
