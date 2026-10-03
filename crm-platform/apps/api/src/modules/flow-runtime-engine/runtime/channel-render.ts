import type { OutboundMessage } from './types';

/** What a channel kind can show beyond text (TW-FLR-019). Interactive content a channel lacks degrades to numbered text. */
export interface ChannelProfile {
  buttons: boolean;
  list: boolean;
  ctaUrl: boolean;
  location: boolean;
  /** Pause between nodes (ms): the unofficial engine looks less like a bot with one (TW-FLR-016 rule 3). */
  paceMs: number;
}

const FULL: ChannelProfile = { buttons: true, list: true, ctaUrl: true, location: true, paceMs: 0 };
const PLAIN: ChannelProfile = {
  buttons: false,
  list: false,
  ctaUrl: false,
  location: true,
  paceMs: 0,
};

export function profileOf(kind: string): ChannelProfile {
  switch (kind) {
    case 'whatsapp_cloud':
    case 'simulator':
      return FULL;
    case 'whatsapp_qr':
      return { ...PLAIN, paceMs: 1500 };
    default:
      return { ...PLAIN, location: false };
  }
}

/** A message ready for the channel adapter: the `interactive`, `location` and `text` shapes of the outbound envelope, or a file. */
export type Rendered =
  | { kind: 'text'; body: string }
  | {
      kind: 'location';
      location: { latitude: number; longitude: number; name?: string; address?: string };
    }
  | {
      kind: 'interactive';
      interactive:
        | {
            type: 'buttons';
            body: string;
            header?: string;
            footer?: string;
            buttons: Array<{ id: string; title: string }>;
          }
        | {
            type: 'list';
            body: string;
            header?: string;
            footer?: string;
            button: string;
            sections: Array<{
              title?: string;
              rows: Array<{ id: string; title: string; description?: string }>;
            }>;
          }
        | {
            type: 'cta_url';
            body: string;
            header?: string;
            footer?: string;
            text: string;
            url: string;
          };
    }
  | {
      kind: 'media';
      mediaKind: 'image' | 'video' | 'audio' | 'document';
      url: string;
      caption?: string;
      filename?: string;
      mimeType?: string;
    };

const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join('');
const numbered = (lines: string[]): string => lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

/**
 * Turns a flow message into what the channel can carry (TW-FLR-019 rules 2 to 4). Reply buttons hold three, so a menu of four to ten
 * becomes a list where the channel has lists; titles, bodies and footers are cut to the Cloud API limits; and a channel with
 * neither gets the options as numbered text, which is what a typed digit answers (the reply router maps it back to the option).
 */
export function renderForChannel(m: OutboundMessage, profile: ChannelProfile): Rendered {
  switch (m.kind) {
    case 'text':
      return { kind: 'text', body: m.body };
    case 'media':
      return {
        kind: 'media',
        mediaKind: m.mediaKind,
        url: m.url,
        ...(m.caption ? { caption: m.caption } : {}),
        ...(m.filename ? { filename: m.filename } : {}),
        ...(m.mimeType ? { mimeType: m.mimeType } : {}),
      };
    case 'location':
      if (profile.location) {
        return {
          kind: 'location',
          location: {
            latitude: m.latitude,
            longitude: m.longitude,
            ...(m.name ? { name: m.name } : {}),
            ...(m.address ? { address: m.address } : {}),
          },
        };
      }
      return {
        kind: 'text',
        body: [
          m.name ? `📍 ${m.name}` : '📍 Location',
          m.address,
          `https://maps.google.com/?q=${m.latitude},${m.longitude}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'buttons': {
      const n = m.buttons.length;
      const header = m.header ? { header: cut(m.header, 60) } : {};
      const footer = m.footer ? { footer: cut(m.footer, 60) } : {};
      if (profile.buttons && n >= 1 && n <= 3) {
        return {
          kind: 'interactive',
          interactive: {
            type: 'buttons',
            body: cut(m.body, 1024),
            ...header,
            ...footer,
            buttons: m.buttons.map((b) => ({ id: cut(b.id, 256), title: cut(b.text, 20) })),
          },
        };
      }
      if (profile.list && n > 3 && n <= 10) {
        return {
          kind: 'interactive',
          interactive: {
            type: 'list',
            body: cut(m.body, 1024),
            ...header,
            ...footer,
            button: 'Select',
            sections: [
              {
                title: 'Options',
                rows: m.buttons.map((b) => ({ id: cut(b.id, 200), title: cut(b.text, 24) })),
              },
            ],
          },
        };
      }
      return {
        kind: 'text',
        body: `${m.body}\n\n${numbered(m.buttons.map((b) => b.text))}\n\nReply with the number (1-${n}):`,
      };
    }
    case 'list': {
      const sections = m.sections.slice(0, 10);
      let budget = 10;
      const capped = sections
        .map((s) => {
          const rows = s.rows.slice(0, Math.max(0, budget));
          budget -= rows.length;
          return {
            ...(s.title ? { title: cut(s.title, 24) } : {}),
            rows: rows.map((r) => ({
              id: cut(r.id, 200),
              title: cut(r.title, 24),
              ...(r.description ? { description: cut(r.description, 72) } : {}),
            })),
          };
        })
        .filter((s) => s.rows.length > 0);
      if (profile.list && capped.length > 0) {
        return {
          kind: 'interactive',
          interactive: {
            type: 'list',
            body: cut(m.body, 1024),
            ...(m.header ? { header: cut(m.header, 60) } : {}),
            ...(m.footer ? { footer: cut(m.footer, 60) } : {}),
            button: cut(m.button || 'Select', 20),
            sections: capped,
          },
        };
      }
      const rows = capped.flatMap((s) => s.rows);
      return {
        kind: 'text',
        body: `${m.body}\n\n${numbered(rows.map((r) => r.title))}\n\nReply with the number (1-${rows.length}):`,
      };
    }
    case 'cta_url':
      if (profile.ctaUrl) {
        return {
          kind: 'interactive',
          interactive: {
            type: 'cta_url',
            body: cut(m.body, 1024),
            ...(m.header ? { header: cut(m.header, 60) } : {}),
            ...(m.footer ? { footer: cut(m.footer, 60) } : {}),
            text: cut(m.text, 20),
            url: m.url,
          },
        };
      }
      return {
        kind: 'text',
        body: [
          m.header ? `*${m.header}*` : '',
          m.body,
          `${m.text}: ${m.url}`,
          m.footer ? `_${m.footer}_` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
  }
}

/** The line the thread shows for a rendered message (the inbox keeps the text; buttons and rows are named in it). */
export function threadTextOf(r: Rendered): string {
  switch (r.kind) {
    case 'text':
      return r.body;
    case 'media':
      return r.caption ?? `[${r.mediaKind}] ${r.filename ?? r.url}`;
    case 'location':
      return `Location: ${r.location.name ?? `${r.location.latitude},${r.location.longitude}`}`;
    case 'interactive': {
      const i = r.interactive;
      if (i.type === 'buttons') return `${i.body}\n[${i.buttons.map((b) => b.title).join(' | ')}]`;
      if (i.type === 'list') {
        return `${i.body}\n[${i.sections.flatMap((s) => s.rows.map((x) => x.title)).join(' | ')}]`;
      }
      return `${i.body}\n[${i.text}: ${i.url}]`;
    }
  }
}
