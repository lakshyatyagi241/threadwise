import { ChannelError, type OutboundEnvelope } from '../chat-conversations/channel.port';
import { META_FAILURE } from './meta-errors';
import { whatsappMediaMessage, type PreparedWhatsappMedia } from './media';

/**
 * Our outbound envelope as the Cloud API `POST /{phone-number-id}/messages` body. Pure: no network, no clock, so every message kind
 * is checked by a table of expected payloads in the unit tests.
 *
 * Rules that exist because Meta rejects the call otherwise: the recipient is digits only; a caption is allowed on an image, a
 * video and a document but not on audio or a sticker; a document carries its file name; a reply names the message it answers in
 * `context`; an empty reaction emoji removes the reaction; a template language is `en_US` style (`en-US` is rewritten).
 */
export type MetaMessageBody = Record<string, unknown>;

const digits = (to: string): string => to.replace(/\D+/g, '');

export function metaRecipient(to: string): string {
  const d = digits(to);
  if (d.length < 4 || d.length > 20) {
    throw new ChannelError(
      META_FAILURE.RECIPIENT_REFUSED,
      'The recipient is not a phone number',
      false,
    );
  }
  return d;
}

/** `en-US`, `EN_us` and `en` all become what Meta takes: `en_US`, `en_US`, `en`. */
export function metaLanguage(code: string): string {
  const [lang, region] = code.trim().replace('-', '_').split('_');
  if (!lang) return 'en';
  return region ? `${lang.toLowerCase()}_${region.toUpperCase()}` : lang.toLowerCase();
}

/** Positional variables (`{"1": "Ana"}`) fill `{{1}}`, `{{2}}` in numeric order; named ones keep their name and order. */
function templateBodyParameters(variables: Record<string, string>): Array<Record<string, string>> {
  const keys = Object.keys(variables);
  if (keys.length === 0) return [];
  const positional = keys.every((k) => /^\d+$/.test(k));
  if (positional) {
    return keys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => ({ type: 'text', text: variables[k] ?? '' }));
  }
  return keys.map((k) => ({ type: 'text', parameter_name: k, text: variables[k] ?? '' }));
}

function interactiveBody(i: Extract<OutboundEnvelope, { kind: 'interactive' }>['interactive']) {
  const head = {
    ...(i.header ? { header: { type: 'text', text: i.header } } : {}),
    body: { text: i.body },
    ...(i.footer ? { footer: { text: i.footer } } : {}),
  };
  switch (i.type) {
    case 'buttons':
      return {
        type: 'button',
        ...head,
        action: {
          buttons: i.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
        },
      };
    case 'list': {
      const rows = i.sections.reduce((n, s) => n + s.rows.length, 0);
      if (rows > 10) {
        throw new ChannelError(
          META_FAILURE.REQUEST_INVALID,
          'A list holds at most 10 rows in total',
          false,
        );
      }
      return {
        type: 'list',
        ...head,
        action: {
          button: i.button,
          sections: i.sections.map((s) => ({
            ...(s.title ? { title: s.title } : {}),
            rows: s.rows.map((r) => ({
              id: r.id,
              title: r.title,
              ...(r.description ? { description: r.description } : {}),
            })),
          })),
        },
      };
    }
    case 'cta_url':
      return {
        type: 'cta_url',
        ...head,
        action: { name: 'cta_url', parameters: { display_text: i.text, url: i.url } },
      };
    case 'flow':
      return {
        type: 'flow',
        ...(i.header ? { header: { type: 'text', text: i.header } } : {}),
        body: { text: i.body },
        ...(i.footer ? { footer: { text: i.footer } } : {}),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: i.flowToken,
            flow_id: i.flowId,
            flow_cta: i.cta,
            flow_action: 'navigate',
            mode: 'published',
          },
        },
      };
  }
}

/** Builds the message body. `media` is what the uploader returned for a `media` envelope (the file is uploaded before this runs). */
export function buildMessageBody(
  envelope: OutboundEnvelope,
  media?: PreparedWhatsappMedia,
): MetaMessageBody {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: metaRecipient(envelope.to),
  };
  const context =
    envelope.replyToProviderMessageId && envelope.kind !== 'reaction'
      ? { context: { message_id: envelope.replyToProviderMessageId } }
      : {};

  switch (envelope.kind) {
    case 'text':
      return {
        ...base,
        ...context,
        type: 'text',
        text: { preview_url: envelope.previewUrl === true, body: envelope.body },
      };

    case 'media': {
      if (!media) throw new Error('A media message needs its uploaded file');
      return { ...base, ...context, ...whatsappMediaMessage(media, envelope.media.caption) };
    }

    case 'template': {
      const t = envelope.template;
      const components = t.components ?? bodyComponents(t.variables);
      return {
        ...base,
        ...context,
        type: 'template',
        template: {
          name: t.name,
          language: { code: metaLanguage(t.language) },
          ...(components.length ? { components } : {}),
        },
      };
    }

    case 'reaction':
      return {
        ...base,
        type: 'reaction',
        reaction: {
          message_id: envelope.reaction.providerMessageId,
          emoji: envelope.reaction.emoji,
        },
      };

    case 'location':
      return {
        ...base,
        ...context,
        type: 'location',
        location: {
          latitude: envelope.location.latitude,
          longitude: envelope.location.longitude,
          ...(envelope.location.name ? { name: envelope.location.name } : {}),
          ...(envelope.location.address ? { address: envelope.location.address } : {}),
        },
      };

    case 'contacts':
      return {
        ...base,
        ...context,
        type: 'contacts',
        contacts: envelope.contacts.map((c) => ({
          name: {
            formatted_name: c.name,
            first_name: c.name.split(/\s+/)[0] ?? c.name,
          },
          ...(c.phones.length
            ? {
                phones: c.phones.map((p) => ({
                  phone: p.phone,
                  type: p.type ?? 'CELL',
                  // Lets WhatsApp show "Message" on the card when this is a WhatsApp number.
                  wa_id: digits(p.phone),
                })),
              }
            : {}),
          ...(c.emails.length ? { emails: c.emails.map((email) => ({ email })) } : {}),
          ...(c.org ? { org: { company: c.org } } : {}),
        })),
      };

    case 'interactive':
      return {
        ...base,
        ...context,
        type: 'interactive',
        interactive: interactiveBody(envelope.interactive),
      };
  }
}

function bodyComponents(variables: Record<string, string>): Array<Record<string, unknown>> {
  const parameters = templateBodyParameters(variables);
  return parameters.length ? [{ type: 'body', parameters }] : [];
}
