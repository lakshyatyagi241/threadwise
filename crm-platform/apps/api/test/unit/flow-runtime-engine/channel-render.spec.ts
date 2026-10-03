import { describe, expect, it } from 'vitest';
import {
  profileOf,
  renderForChannel,
  threadTextOf,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `b_x_p${i}`,
    text: `Option number ${i + 1} is long`,
  }));

describe('rendering for a channel', () => {
  it('up to three buttons stay buttons with titles cut to 20', () => {
    const r = renderForChannel(
      { kind: 'buttons', body: 'Pick', buttons: items(3) },
      profileOf('whatsapp_cloud'),
    );
    expect(r.kind).toBe('interactive');
    if (r.kind !== 'interactive' || r.interactive.type !== 'buttons') throw new Error('shape');
    expect(r.interactive.buttons[0]!.title.length).toBe(20);
  });

  it('four buttons become a list of rows where the channel has lists', () => {
    const r = renderForChannel(
      { kind: 'buttons', body: 'Pick', buttons: items(4) },
      profileOf('whatsapp_cloud'),
    );
    expect(r).toMatchObject({ kind: 'interactive', interactive: { type: 'list' } });
  });

  it('more than ten, or a channel without buttons, becomes numbered text', () => {
    const big = renderForChannel(
      { kind: 'buttons', body: 'Pick', buttons: items(11) },
      profileOf('whatsapp_cloud'),
    );
    expect(big.kind).toBe('text');
    const qr = renderForChannel(
      { kind: 'buttons', body: 'Pick', buttons: items(2) },
      profileOf('whatsapp_qr'),
    );
    expect(qr).toMatchObject({ kind: 'text' });
    expect((qr as { body: string }).body).toContain('1. Option number 1 is long');
    expect((qr as { body: string }).body).toContain('Reply with the number (1-2):');
  });

  it('caps a list at ten rows and ten sections, and cuts titles', () => {
    const sections = Array.from({ length: 3 }, (_, s) => ({
      title: `Section ${s}`,
      rows: Array.from({ length: 6 }, (_, i) => ({
        id: `r${s}${i}`,
        title: 'x'.repeat(40),
        description: 'd'.repeat(90),
      })),
    }));
    const r = renderForChannel(
      { kind: 'list', body: 'Choose', button: 'Open the whole list now', sections },
      profileOf('whatsapp_cloud'),
    );
    if (r.kind !== 'interactive' || r.interactive.type !== 'list') throw new Error('shape');
    expect(r.interactive.sections.flatMap((s) => s.rows).length).toBe(10);
    expect(r.interactive.sections[0]!.rows[0]!.title.length).toBe(24);
    expect(r.interactive.sections[0]!.rows[0]!.description!.length).toBe(72);
    expect(r.interactive.button.length).toBe(20);
  });

  it('a list on a plain channel is numbered text in rendered order', () => {
    const r = renderForChannel(
      {
        kind: 'list',
        body: 'Choose',
        button: 'Open',
        sections: [
          {
            title: 'S',
            rows: [
              { id: 'a', title: 'Alpha' },
              { id: 'b', title: 'Beta' },
            ],
          },
        ],
      },
      profileOf('telegram'),
    );
    expect(r).toEqual({
      kind: 'text',
      body: 'Choose\n\n1. Alpha\n2. Beta\n\nReply with the number (1-2):',
    });
  });

  it('a link button degrades to a labelled line', () => {
    const r = renderForChannel(
      { kind: 'cta_url', body: 'Site', text: 'Visit', url: 'https://x.test', header: 'Hi' },
      profileOf('whatsapp_qr'),
    );
    expect(r).toEqual({ kind: 'text', body: '*Hi*\n\nSite\n\nVisit: https://x.test' });
  });

  it('a location is a text with a maps link where pins are not carried', () => {
    const r = renderForChannel(
      { kind: 'location', latitude: 1, longitude: 2, name: 'HQ' },
      profileOf('telegram'),
    );
    expect(r).toEqual({ kind: 'text', body: '📍 HQ\nhttps://maps.google.com/?q=1,2' });
  });

  it('names the options in the thread text', () => {
    const r = renderForChannel(
      { kind: 'buttons', body: 'Pick', buttons: items(2) },
      profileOf('simulator'),
    );
    expect(threadTextOf(r)).toContain('Pick');
  });
});
