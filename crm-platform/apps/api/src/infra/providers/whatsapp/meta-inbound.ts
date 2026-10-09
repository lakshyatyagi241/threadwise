import type {
  NormalisedInbound,
  NormalisedReceipt,
  ParsedInbound,
} from '../chat-conversations/channel.port';
import { classifyMetaCode, describeMetaError } from './meta-errors';

/**
 * A Cloud API webhook payload as normalised messages and delivery receipts. Pure, and total: any shape in, a `ParsedInbound` out;
 * it never throws on what it does not understand, because the delivery was already authenticated and a thrown error would make Meta
 * redeliver the whole batch (and, past enough failures, switch the subscription off).
 *
 * What becomes what (WaDesk's `extractMetaInboundContent` is the behavioural reference):
 *   text, image, video, audio (voice flag), document, sticker, location, contacts, reaction (empty emoji = removed), button (template
 *   quick reply), interactive (button_reply, list_reply, nfm_reply), order, unsupported (Meta 131051) and any type we have never heard of
 *   -> a message; an unknown type is stored as an `unsupported` placeholder with its raw type in `meta.rawType`, never dropped.
 *   system (a customer changed number or identity), a message from the number itself (a coexistence echo), a group message and a
 *   change that names another phone number than this channel's -> ignored, reported in `ignored` for the log.
 *   statuses sent / delivered / read / failed -> receipts (a failure carries the first error, classified into our vocabulary).
 *
 * Group messages are ignored rather than stored as one-to-one threads: their `from` is a group member, and a thread keyed by it
 * would be wrong. Groups are a separate feature (WD-WABA-039) and not part of this channel yet.
 */

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const dict = (v: unknown): Dict => (isDict(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const clip = (v: unknown, max: number): string | undefined => str(v)?.slice(0, max);
const digitsOf = (v: string): string => v.replace(/\D+/g, '');


export const UNSUPPORTED_131051 =
  "[Unsupported message - the customer sent something the WhatsApp Business API can't display]";

export interface InboundContext {
  /** This channel's phone number id: changes that name another number are not ours. */
  phoneNumberId?: string | null;
}

function timestampOf(v: unknown): Date {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

export function normaliseMetaWebhook(payload: unknown, ctx: InboundContext = {}): ParsedInbound {
  const out: ParsedInbound = { messages: [], receipts: [], ignored: [] };
  const ignore = (reason: string, detail?: string) => out.ignored!.push({ reason, ...(detail ? { detail } : {}) });

  for (const entry of arr(dict(payload).entry)) {
    for (const change of arr(dict(entry).changes)) {
      const field = str(dict(change).field);
      // `field` is absent in some older deliveries; a value with messages or statuses is read either way.
      if (field !== undefined && field !== 'messages') {
        ignore('field', field);
        continue;
      }
      const value = dict(dict(change).value);
      const metadata = dict(value.metadata);
      const phoneId = str(metadata.phone_number_id);
      if (phoneId && ctx.phoneNumberId && phoneId !== ctx.phoneNumberId) {
        ignore('other_number', phoneId);
        continue;
      }
      const ownNumber = digitsOf(str(metadata.display_phone_number) ?? '');

      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str(dict(c).wa_id);
        const name = str(dict(dict(c).profile).name);
        if (waId && name) names.set(digitsOf(waId), name.slice(0, 200));
      }

      for (const m of arr(value.messages)) {
        const mapped = mapMessage(dict(m), names, ownNumber);
        if ('ignored' in mapped) ignore(mapped.ignored, mapped.detail);
        else out.messages.push(mapped);
      }
      for (const s of arr(value.statuses)) {
        const mapped = mapStatus(dict(s));
        if ('ignored' in mapped) ignore(mapped.ignored, mapped.detail);
        else out.receipts.push(mapped);
      }
    }
  }
  return out;
}

type Skip = { ignored: string; detail?: string };

function mapMessage(m: Dict, names: Map<string, string>, ownNumber: string): NormalisedInbound | Skip {
  const id = str(m.id);
  const type = str(m.type) ?? '';
  if (!id) return { ignored: 'no_message_id', detail: type };
  if (str(m.group_id)) return { ignored: 'group_message', detail: type };
  if (type === 'system') return { ignored: 'system', detail: str(dict(m.system).type) };

  const from = digitsOf(str(m.from) ?? '');
  if (!from) return { ignored: 'no_sender', detail: type };
  // A message typed in the business app on the same number arrives from our own number (coexistence): not a customer's.
  if (ownNumber && from === ownNumber) return { ignored: 'own_number_echo', detail: type };

  const meta: Record<string, unknown> = {};
  const context = dict(m.context);
  if (context.forwarded === true || context.frequently_forwarded === true) meta.forwarded = true;
  const product = dict(context.referred_product);
  if (str(product.product_retailer_id)) {
    meta.referredProduct = {
      catalogId: str(product.catalog_id) ?? null,
      productRetailerId: str(product.product_retailer_id),
    };
  }
  const referral = dict(m.referral);
  if (Object.keys(referral).length > 0) {
    meta.referral = {
      sourceType: clip(referral.source_type, 40) ?? null,
      sourceUrl: clip(referral.source_url, 1000) ?? null,
      sourceId: clip(referral.source_id, 100) ?? null,
      headline: clip(referral.headline, 300) ?? null,
      body: clip(referral.body, 1000) ?? null,
      ctwaClid: clip(referral.ctwa_clid, 300) ?? null,
    };
  }
  const providerErrors = arr(m.errors)
    .map((e) => dict(e).code)
    .filter((c): c is number => typeof c === 'number');
  if (providerErrors.length) meta.providerErrors = providerErrors;

  const base = {
    providerMessageId: id,
    peerKey: from,
    peerName: names.get(from),
    providerTimestamp: timestampOf(m.timestamp),
    replyToProviderMessageId: str(context.id),
  };
  const withMeta = (extra: Record<string, unknown> = {}) => {
    const merged = { ...meta, ...extra };
    return Object.keys(merged).length ? { meta: merged } : {};
  };
  const unsupported = (rawType: string, body: string, extra: Record<string, unknown> = {}): NormalisedInbound => ({
    ...base,
    kind: 'unsupported',
    body,
    ...withMeta({ rawType, ...extra }),
  });

  switch (type) {
    case 'text':
      return { ...base, kind: 'text', body: str(dict(m.text).body), ...withMeta() };

    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const f = dict(m[type]);
      const mediaId = str(f.id);
      if (!mediaId) return unsupported(type, `[${cap(type)} message]`, { reason: 'no_media_id' });
      const mime = str(f.mime_type) ?? 'application/octet-stream';
      const voice = type === 'audio' && f.voice === true;
      return {
        ...base,
        kind: 'media',
        body: clip(f.caption, 1024),
        media: {
          providerMediaId: mediaId,
          mediaKind: type,
          mime,
          name: clip(f.filename, 255),
          sha256: str(f.sha256),
          ...(voice ? { voice: true } : {}),
        },
        ...withMeta(type === 'sticker' && f.animated === true ? { animated: true } : {}),
      };
    }

    case 'location': {
      const l = dict(m.location);
      const latitude = Number(l.latitude);
      const longitude = Number(l.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return unsupported('location', '[Location message]');
      return {
        ...base,
        kind: 'location',
        location: {
          latitude,
          longitude,
          name: clip(l.name, 255),
          address: clip(l.address, 500),
        },
        ...withMeta(),
      };
    }

    case 'contacts': {
      const cards = arr(m.contacts)
        .slice(0, 10)
        .map((c) => {
          const card = dict(c);
          const name = dict(card.name);
          const formatted =
            clip(name.formatted_name, 200) ??
            ([str(name.first_name), str(name.last_name)].filter(Boolean).join(' ').slice(0, 200) || null);
          return {
            name: formatted,
            phones: arr(card.phones)
              .map((p) => str(dict(p).phone) ?? str(dict(p).wa_id))
              .filter((p): p is string => !!p)
              .slice(0, 5),
            emails: arr(card.emails)
              .map((e) => str(dict(e).email))
              .filter((e): e is string => !!e)
              .slice(0, 5),
            org: clip(dict(card.org).company, 200) ?? null,
          };
        });
      return {
        ...base,
        kind: 'contact',
        // WaDesk's bubble text is the first formatted name; the cards themselves are in the meta.
        body: cards.find((c) => c.name)?.name ?? (cards.length ? undefined : '[Contact message]'),
        ...withMeta({ contacts: cards }),
      };
    }

    case 'reaction': {
      const r = dict(m.reaction);
      return {
        ...base,
        kind: 'reaction',
        replyToProviderMessageId: str(r.message_id),
        // An absent or empty emoji is a removed reaction.
        reactionEmoji: str(r.emoji) ?? '',
        ...withMeta(),
      };
    }

    case 'button': {
      const b = dict(m.button);
      const title = clip(b.text, 200) ?? '';
      return {
        ...base,
        kind: 'interactive',
        body: title,
        ...withMeta({
          interactive: { type: 'button', id: null, title, description: null },
          buttonPayload: clip(b.payload, 1000) ?? null,
        }),
      };
    }

    case 'interactive': {
      const i = dict(m.interactive);
      const kind = str(i.type);
      if (kind === 'button_reply') {
        const r = dict(i.button_reply);
        const title = clip(r.title, 200) ?? clip(r.id, 256) ?? '';
        return {
          ...base,
          kind: 'interactive',
          body: title,
          ...withMeta({
            interactive: { type: 'button_reply', id: clip(r.id, 256) ?? null, title, description: null },
          }),
        };
      }
      if (kind === 'list_reply') {
        const r = dict(i.list_reply);
        const title = clip(r.title, 200) ?? clip(r.description, 200) ?? clip(r.id, 200) ?? '';
        return {
          ...base,
          kind: 'interactive',
          body: title,
          ...withMeta({
            interactive: {
              type: 'list_reply',
              id: clip(r.id, 200) ?? null,
              title,
              description: clip(r.description, 200) ?? null,
            },
          }),
        };
      }
      if (kind === 'nfm_reply') {
        const r = dict(i.nfm_reply);
        return {
          ...base,
          kind: 'interactive',
          body: flowSummary(r.response_json) ?? clip(r.body, 1000) ?? 'Form submitted',
          ...withMeta({ flowName: clip(r.name, 200) ?? null, flowResponse: clip(r.response_json, 4000) ?? null }),
        };
      }
      if (kind === 'call_permission_reply') {
        // The customer answered our request to call them: a readable chip, not a placeholder.
        const r = dict(i.call_permission_reply);
        const response = str(r.response);
        const title =
          response === 'accept'
            ? 'Allowed calls'
            : response === 'reject'
              ? 'Declined calls'
              : 'Call permission reply';
        return {
          ...base,
          kind: 'interactive',
          body: title,
          ...withMeta({
            interactive: { type: 'button_reply', id: null, title, description: r.is_permanent === true ? 'Permanent' : null },
            callPermission: {
              response: response ?? null,
              permanent: r.is_permanent === true,
              expiresAt: typeof r.expiration_timestamp === 'number' ? r.expiration_timestamp : null,
            },
          }),
        };
      }
      return unsupported('interactive', `[Interactive · ${kind ?? 'message'}]`, { interactiveType: kind ?? null });
    }

    case 'order': {
      const o = dict(m.order);
      const items = arr(o.product_items).map(dict);
      const lines = items
        .slice(0, 20)
        .map((i) => `${Number(i.quantity) || 1} x ${str(i.product_retailer_id) ?? 'item'}`);
      const text = [clip(o.text, 1000), `Order · ${items.length} item(s)`, ...lines].filter(Boolean).join('\n');
      return unsupported('order', text, {
        order: { catalogId: str(o.catalog_id) ?? null, items: items.length },
      });
    }

    // The customer opened the chat for the first time (a button tap in a click-to-chat flow): an event, not a message to read.
    case 'request_welcome':
      return { ignored: 'request_welcome' };

    case 'unsupported':
      return unsupported('unsupported', UNSUPPORTED_131051);

    default:
      return unsupported(type || 'unknown', type ? `[${cap(type)} message]` : '[Message]');
  }
}

const cap = (s: string): string => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A Flow answer (`response_json`) as readable `Label: value` lines; anything that is not a flat object is shown as it came. */
function flowSummary(raw: unknown): string | undefined {
  const text = str(raw);
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isDict(parsed)) return undefined;
    const lines = Object.entries(parsed)
      .filter(([k, v]) => k !== 'flow_token' && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    return lines.length ? lines.join('\n').slice(0, 1000) : undefined;
  } catch {
    return undefined;
  }
}

function mapStatus(s: Dict): NormalisedReceipt | Skip {
  const id = str(s.id);
  const status = str(s.status);
  if (!id) return { ignored: 'status_without_id' };
  if (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed') {
    return { ignored: 'status', detail: status };
  }
  if (str(s.recipient_type) === 'group') return { ignored: 'group_status', detail: status };

  const receipt: NormalisedReceipt = { providerMessageId: id, status, at: timestampOf(s.timestamp) };
  if (status === 'failed') {
    const e = dict(arr(s.errors)[0]);
    const code = typeof e.code === 'number' ? e.code : null;
    const sub = typeof e.error_subcode === 'number' ? e.error_subcode : null;
    const known = classifyMetaCode(code, sub);
    receipt.errorCode = known?.code ?? (code !== null ? String(code) : undefined);
    receipt.errorMessage = describeMetaError({
      message: str(e.message) ?? str(e.title),
      error_data: dict(e.error_data),
      error_user_msg: e.error_user_msg,
      code: e.code,
      error_subcode: e.error_subcode,
    });
  }
  return receipt;
}
