import { describe, expect, it } from 'vitest';
import { BaileysSocketFactory } from '../../../src/infra/providers/node-bridge-runtime/baileys.socket-factory';
import {
  UnsupportedSendError,
  type SendCommand,
} from '../../../src/infra/providers/node-bridge-runtime/outbound.port';

/** What a command becomes for the library (TW-NODE-022 to 024). The socket itself needs live WhatsApp; this part does not. */
const fetched = (mimetype: string) => ({
  fetchMedia: async (url: string) => ({
    buffer: Buffer.from('bytes'),
    mimetype,
    extension: '.x',
    finalUrl: url,
  }),
});
const content = (cmd: SendCommand, mime = 'application/octet-stream') =>
  (
    new BaileysSocketFactory({} as never, fetched(mime) as never) as unknown as {
      content(c: SendCommand): Promise<Record<string, unknown>>;
    }
  ).content(cmd);

describe('text', () => {
  it('is the body, with a caller footer after a blank line', async () => {
    expect(await content({ type: 'text', to: '1', body: 'Hi' })).toEqual({ text: 'Hi' });
    expect(await content({ type: 'text', to: '1', body: 'Hi', footer: 'Bye' })).toEqual({
      text: 'Hi\n\nBye',
    });
  });
  it('a group message names its mentions as chat ids', async () => {
    expect(
      await content({
        type: 'group_text',
        groupJid: '1',
        body: 'hi @919800000001',
        mentions: ['+91 98000 00001'],
      }),
    ).toEqual({
      text: 'hi @919800000001',
      mentions: ['919800000001@s.whatsapp.net'],
    });
    expect(await content({ type: 'group_text', groupJid: '1', body: 'hi' })).toEqual({
      text: 'hi',
    });
  });
});

describe('location (TW-NODE-024 rule 1)', () => {
  it('carries the pin, and a name and address only when they say something, cut to 200 characters', async () => {
    expect(await content({ type: 'location', to: '1', latitude: 12.9, longitude: 77.6 })).toEqual({
      location: { degreesLatitude: 12.9, degreesLongitude: 77.6 },
    });
    const long = 'x'.repeat(300);
    const r = (await content({
      type: 'location',
      to: '1',
      latitude: 1,
      longitude: 2,
      name: `  ${long}  `,
      address: ' ',
    })) as {
      location: { name: string; address?: string };
    };
    expect(r.location.name).toHaveLength(200);
    expect(r.location.address).toBeUndefined();
  });
});

describe('contact (rule 2)', () => {
  it('builds a vCard 3.0 from a name and a number when none is given', async () => {
    const r = (await content({
      type: 'contact',
      to: '1',
      name: 'Ravi',
      phone: '+91 90000 00001',
    })) as {
      contacts: { displayName: string; contacts: Array<{ vcard: string }> };
    };
    expect(r.contacts.displayName).toBe('Ravi');
    expect(r.contacts.contacts[0]!.vcard).toBe(
      'BEGIN:VCARD\nVERSION:3.0\nFN:Ravi\nTEL;type=CELL;type=VOICE;waid=919000000001:+919000000001\nEND:VCARD',
    );
  });
  it('uses the card it is given', async () => {
    const r = (await content({
      type: 'contact',
      to: '1',
      name: 'R',
      phone: '1',
      vcard: 'MY-CARD',
    })) as {
      contacts: { contacts: Array<{ vcard: string }> };
    };
    expect(r.contacts.contacts[0]!.vcard).toBe('MY-CARD');
  });
});

describe('media (TW-NODE-023)', () => {
  const media = (over: Partial<Extract<SendCommand, { type: 'media' }>> = {}): SendCommand => ({
    type: 'media',
    to: '1',
    mediaUrl: 'https://cdn.test/files/brochure.pdf',
    ...over,
  });

  it('the message kind follows the type: image, video, audio, otherwise a document with its file name', async () => {
    expect(await content(media(), 'image/png')).toMatchObject({
      image: expect.any(Buffer),
      mimetype: 'image/png',
    });
    expect(await content(media(), 'video/mp4')).toMatchObject({ video: expect.any(Buffer) });
    expect(await content(media(), 'audio/mpeg')).toMatchObject({
      audio: expect.any(Buffer),
      ptt: false,
    });
    expect(await content(media(), 'application/pdf')).toMatchObject({
      document: expect.any(Buffer),
      mimetype: 'application/pdf',
      fileName: 'brochure.pdf',
    });
  });

  it("the caller's type wins unless it is blank or the generic one", async () => {
    expect(await content(media({ mimeType: 'image/webp' }), 'application/pdf')).toMatchObject({
      image: expect.any(Buffer),
      mimetype: 'image/webp',
    });
    expect(
      await content(media({ mimeType: 'application/octet-stream' }), 'image/png'),
    ).toMatchObject({ image: expect.any(Buffer) });
    expect(await content(media({ mimeType: '' }), 'video/mp4')).toMatchObject({
      video: expect.any(Buffer),
    });
  });

  it('a voice note is marked push-to-talk; the caption rides on image, video and document but not audio', async () => {
    expect(await content(media({ voiceNote: true }), 'audio/ogg')).toMatchObject({ ptt: true });
    expect(await content(media({ caption: 'Look' }), 'image/png')).toMatchObject({
      caption: 'Look',
    });
    expect(await content(media({ caption: 'Spec' }), 'application/pdf')).toMatchObject({
      caption: 'Spec',
    });
    expect(await content(media({ caption: 'x' }), 'audio/ogg')).not.toHaveProperty('caption');
  });

  it('a document without a name in the address is called "file", and a given name is kept', async () => {
    expect(
      await content(media({ mediaUrl: 'https://cdn.test/' }), 'application/zip'),
    ).toMatchObject({ fileName: 'file' });
    expect(await content(media({ fileName: 'Offer.pdf' }), 'application/pdf')).toMatchObject({
      fileName: 'Offer.pdf',
    });
  });

  it('refuses an internal address through the shared fetch guard', async () => {
    const { SafeFetch } =
      await import('../../../src/infra/providers/node-bridge-runtime/safe-fetch');
    const f = new BaileysSocketFactory({} as never, new SafeFetch()) as unknown as {
      content(c: SendCommand): Promise<unknown>;
    };
    await expect(
      f.content({ type: 'media', to: '1', mediaUrl: 'http://169.254.169.254/latest' }),
    ).rejects.toThrow('Blocked internal media host');
    await expect(f.content({ type: 'media', to: '1', mediaUrl: '/etc/passwd' })).rejects.toThrow();
  });
});

describe('a kind the engine cannot send', () => {
  it('says so instead of sending something else', async () => {
    await expect(content({ type: 'template' } as never)).rejects.toBeInstanceOf(
      UnsupportedSendError,
    );
  });
});
