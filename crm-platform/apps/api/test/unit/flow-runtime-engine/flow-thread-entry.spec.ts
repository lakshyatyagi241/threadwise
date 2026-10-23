import { describe, expect, it } from 'vitest';
import {
  profileOf,
  renderForChannel,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';
import { flowThreadEntryOf } from '../../../src/modules/flow-runtime-engine/runtime/flow-sender.service';
import type { OutboundMessage } from '../../../src/modules/flow-runtime-engine/runtime/types';
import { toMessageResponse } from '../../../src/modules/chat-conversations/message.mapper';
import type { MessageRow } from '../../../src/modules/chat-conversations/messages.repository';

/** What the thread keeps for a flow message sent on a channel: the same path `FlowSender` takes. */
const entry = (channelKind: string, m: OutboundMessage, envelope: unknown = null) =>
  flowThreadEntryOf(channelKind, m, renderForChannel(m, profileOf(channelKind)), envelope);

const buttons: OutboundMessage = {
  kind: 'buttons',
  body: 'Pick one',
  footer: 'Thanks',
  buttons: [
    { id: 'b1', text: 'Yes' },
    { id: 'b2', text: 'No' },
  ],
};

describe('a Buttons node in the thread', () => {
  it('keeps the question and its buttons, not the option names in brackets', () => {
    const e = entry('whatsapp_cloud', buttons);
    expect(e.body).toBe('Pick one');
    expect(e.meta).toEqual({
      sentInteractive: {
        type: 'buttons',
        body: 'Pick one',
        footer: 'Thanks',
        buttons: [
          { id: 'b1', title: 'Yes' },
          { id: 'b2', title: 'No' },
        ],
      },
    });
    expect(e.media).toBeUndefined();
  });

  it('keeps the buttons for the website window as well', () => {
    const e = entry('webchat', buttons);
    expect(e.body).toBe('Pick one');
    expect(e.meta).toMatchObject({
      sentInteractive: { type: 'buttons', buttons: [{ title: 'Yes' }, { title: 'No' }] },
      widget_buttons: [
        { id: 'b1', title: 'Yes' },
        { id: 'b2', title: 'No' },
      ],
    });
  });

  it('keeps a menu a channel cannot draw as its numbered text', () => {
    const e = entry('telegram', buttons);
    expect(e.meta).toBeUndefined();
    expect(e.body).toContain('1. Yes');
    expect(e.body).toContain('Reply with the number (1-2):');
  });
});

describe('an Interactive list node in the thread', () => {
  it('keeps the rows by section and the button that opens them', () => {
    const e = entry('whatsapp_cloud', {
      kind: 'list',
      body: 'Pick a size',
      button: 'Sizes',
      sections: [{ title: 'Shirts', rows: [{ id: 'r1', title: 'Small', description: '6-8' }] }],
    });
    expect(e.body).toBe('Pick a size');
    expect(e.meta).toEqual({
      sentInteractive: {
        type: 'list',
        body: 'Pick a size',
        button: 'Sizes',
        sections: [{ title: 'Shirts', rows: [{ id: 'r1', title: 'Small', description: '6-8' }] }],
      },
    });
  });
});

describe('a Carousel node in the thread', () => {
  const carousel: Extract<OutboundMessage, { kind: 'carousel' }> = {
    kind: 'carousel',
    body: 'Our range',
    cards: [
      {
        title: 'Running shoes',
        text: 'Light',
        image: 'https://cdn.x.io/shoe.png',
        buttons: [
          { kind: 'reply', id: 'p0', title: 'Buy' },
          { kind: 'link', label: 'Site', url: 'https://x.io' },
        ],
      },
    ],
  };

  it('keeps its intro line and its cards, and the website window its own copy of the cards', () => {
    const e = entry('webchat', carousel);
    expect(e.body).toBe('Our range');
    const cards = [
      {
        title: 'Running shoes',
        text: 'Light',
        image: 'https://cdn.x.io/shoe.png',
        buttons: [
          { title: 'Buy', url: null },
          { title: 'Site', url: 'https://x.io' },
        ],
      },
    ];
    expect(e.meta).toEqual({
      sentCarousel: { cards },
      widget_cards: carousel.cards,
    });
  });

  it('keeps the cards on every channel, without the window copy', () => {
    const e = entry('whatsapp_cloud', carousel);
    expect(e.meta).toEqual({
      sentCarousel: {
        cards: [
          {
            title: 'Running shoes',
            text: 'Light',
            image: 'https://cdn.x.io/shoe.png',
            buttons: [
              { title: 'Buy', url: null },
              { title: 'Site', url: 'https://x.io' },
            ],
          },
        ],
      },
    });
  });
});

describe('a Media node in the thread', () => {
  const media: OutboundMessage = {
    kind: 'media',
    mediaKind: 'image',
    url: 'https://x.io/logo.png',
    caption: 'Our logo',
    filename: 'logo.png',
  };
  const envelope = {
    media: {
      key: 'org-1/logo.png',
      mediaKind: 'image',
      mime: 'image/png',
      name: 'logo.png',
      sha256: 'abc',
      caption: 'Our logo',
    },
  };

  it('is the file message it is, with its caption, on every channel', () => {
    expect(entry('whatsapp_cloud', media, envelope)).toEqual({
      body: 'Our logo',
      media: {
        mediaKind: 'image',
        key: 'org-1/logo.png',
        mime: 'image/png',
        size: null,
        name: 'logo.png',
        sha256: 'abc',
      },
    });
  });

  it('gives the website window the key it reads its file from', () => {
    expect(entry('webchat', media, envelope).meta).toEqual({
      widget_media: { key: 'org-1/logo.png', kind: 'image', mime: 'image/png', name: 'logo.png' },
    });
  });

  it('keeps its text line when the file was not stored', () => {
    const e = entry('whatsapp_cloud', media, null);
    expect(e.media).toBeUndefined();
    expect(e.body).toBe('Our logo');
  });
});

describe('what the thread keeps reads back in the inbox', () => {
  it('maps a stored carousel to the cards the bubble draws', () => {
    const e = entry('webchat', {
      kind: 'carousel',
      body: 'Our range',
      cards: [
        {
          title: 'Hats',
          text: '',
          buttons: [{ kind: 'link', label: 'Open', url: 'https://x.io/hats' }],
        },
      ],
    });
    const wire = toMessageResponse(
      {
        kind: 'text',
        body: e.body,
        mediaKey: null,
        meta: e.meta,
        direction: 'out',
        status: 'sent',
        createdAt: new Date(0),
      } as unknown as MessageRow,
      () => null,
    );
    expect(wire.sentCarousel).toEqual({
      cards: [
        {
          title: 'Hats',
          text: '',
          image: null,
          buttons: [{ title: 'Open', url: 'https://x.io/hats' }],
        },
      ],
    });
    expect(wire.body).toBe('Our range');
  });
});
