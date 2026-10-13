import { describe, expect, it } from 'vitest';
import {
  ScheduleMessageBuilder,
  type MessageSource,
} from '../../../src/modules/scheduled-queue-warmer/schedule-message-builder.service';
import { UnsupportedSendError } from '../../../src/modules/node-bridge-runtime';

/**
 * What a schedule row becomes for one recipient (TW-SCHED-006): the plain text with its merge tags, a link or an uploaded file, a pin,
 * and a template, which goes out as Meta's template on a Cloud API number and as the approved text on every other engine.
 */
const template = (over: Record<string, unknown> = {}) => ({
  id: 7,
  uuid: 'u',
  templateName: 'Spring Promo',
  language: 'en',
  templateBody: 'Hi {{1}}, your offer is ready',
  header: null,
  footer: 'Reply STOP',
  headerLocation: null,
  parameterFormat: 'POSITIONAL',
  variableMap: { body: [{ num: 1, key: 'first_name' }] },
  buttons: [],
  carouselData: null,
  templateType: 'standard',
  attachmentType: null,
  attachmentFile: null,
  metaTemplateId: 'meta-1',
  metaStatus: 'APPROVED',
  pausedUntil: null,
  qualityScore: null,
  ...over,
});

function builder(opts: { tpl?: ReturnType<typeof template> | undefined; media?: string } = {}) {
  const queries: string[] = [];
  const tx = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q);
      queries.push(text);
      if (text.includes('scheduled_media')) {
        return { rows: [{ mime: 'image/png', file_name: 'offer.png' }] };
      }
      if (text.includes('FROM wa_templates')) {
        return { rows: [{ category: 'marketing', meta_category: 'marketing' }] };
      }
      return { rows: [] };
    },
  };
  const merge = {
    baseContext: async () => ({
      attributeDefaults: new Map<string, string | null>(),
      system: { today: '2031-03-10', businessName: 'Acme', companyName: 'Acme' },
    }),
  };
  const storage = { url: async (k: string) => opts.media ?? `https://files.test/${k}?sig=1` };
  const templates = {
    findById: async () => opts.tpl,
    mediaUrl: (p: string) => `https://cdn.test/${p}`,
    wabaTemplatesV2Enabled: async () => false,
  };
  return {
    b: new ScheduleMessageBuilder(merge as never, storage as never, templates as never),
    tx: tx as never,
    queries,
  };
}

const row = (over: Partial<MessageSource> = {}): MessageSource => ({
  template_type: 'text',
  message_content: 'Hello {{first_name}}',
  media_file: null,
  latitude: null,
  longitude: null,
  template_id: null,
  template_overrides: null,
  ...over,
});
const contact = { name: 'Asha K', firstName: 'Asha', phone: '+919822000001' } as never;

describe('plain text and captions', () => {
  it('fills the merge tags from the contact, and spins the result when the number is warming', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(tx, 1, row(), 'baileys');
    expect(b.command(p, '919822000001', contact)).toEqual({
      type: 'text',
      to: '919822000001',
      body: 'Hello Asha',
    });
    expect(b.command(p, '919822000001', contact, (s) => s.toUpperCase())).toMatchObject({
      body: 'HELLO ASHA',
    });
  });

  it('leaves text without tags alone, and does not need a contact', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(tx, 1, row({ message_content: 'Plain' }), 'baileys');
    expect(p.mergeBase).toBeNull();
    expect(b.command(p, '1', undefined)).toMatchObject({ body: 'Plain' });
  });
});

describe('files', () => {
  it('uses a pasted link as typed', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(
      tx,
      1,
      row({ template_type: 'media_with_caption', media_file: 'https://example.com/a.png' }),
      'baileys',
    );
    expect(b.command(p, '1', contact)).toEqual({
      type: 'media',
      to: '1',
      mediaUrl: 'https://example.com/a.png',
      caption: 'Hello Asha',
    });
  });

  it('signs an uploaded file for the run and passes its type and name; no caption means none sent', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(
      tx,
      1,
      row({ template_type: 'media', media_file: 'scheduled/1/abc.png', message_content: '' }),
      'waba',
    );
    expect(b.command(p, '1', undefined)).toEqual({
      type: 'media',
      to: '1',
      mediaUrl: 'https://files.test/scheduled/1/abc.png?sig=1',
      mimeType: 'image/png',
      fileName: 'offer.png',
    });
  });

  it('refuses a file stored on this server (no provider could fetch it) and a file that is gone', async () => {
    const local = builder({ media: '/storage/scheduled/1/abc.png' });
    await expect(
      local.b.prepare(
        local.tx,
        1,
        row({ template_type: 'media', media_file: 'scheduled/1/abc.png' }),
        'baileys',
      ),
    ).rejects.toThrow(/cloud storage/);
    const gone = builder();
    (gone.tx as unknown as { execute: unknown }).execute = async () => ({ rows: [] });
    await expect(
      gone.b.prepare(
        gone.tx,
        1,
        row({ template_type: 'media', media_file: 'scheduled/1/x.png' }),
        'baileys',
      ),
    ).rejects.toThrow(/no longer available/);
    await expect(
      gone.b.prepare(gone.tx, 1, row({ template_type: 'media', media_file: null }), 'baileys'),
    ).rejects.toThrow(UnsupportedSendError);
  });
});

describe('a pin', () => {
  it('sends the coordinates and the place name, and refuses a pin without coordinates', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(
      tx,
      1,
      row({
        template_type: 'location',
        latitude: '26.9124000',
        longitude: '75.7873000',
        message_content: 'Shop',
      }),
      'baileys',
    );
    expect(b.command(p, '1', undefined)).toEqual({
      type: 'location',
      to: '1',
      latitude: 26.9124,
      longitude: 75.7873,
      name: 'Shop',
    });
    await expect(b.prepare(tx, 1, row({ template_type: 'location' }), 'baileys')).rejects.toThrow(
      /no coordinates/,
    );
  });
});

describe('a template', () => {
  const src = (over: Partial<MessageSource> = {}) =>
    row({ template_type: 'template', template_id: 7, message_content: 'Hi {{1}}', ...over });

  it("goes to a Cloud API number as Meta's template, with the contact's values and the person's overrides", async () => {
    const { b, tx } = builder({ tpl: template() });
    const p = await b.prepare(tx, 1, src(), 'waba');
    const c = b.command(p, '919822000001', contact);
    expect(c).toMatchObject({
      type: 'template',
      to: '919822000001',
      templateName: 'spring_promo',
      language: 'en',
      category: 'marketing',
    });
    expect(JSON.stringify((c as { components: unknown }).components)).toContain('Asha');

    const o = await b.prepare(
      tx,
      1,
      src({ template_overrides: { body: ['VIP {{first_name}}'] } }),
      'waba',
    );
    expect(
      JSON.stringify((b.command(o, '1', contact) as { components: unknown }).components),
    ).toContain('VIP Asha');
    // a blank slot falls back to what the template does, never an empty parameter
    const none = await b.prepare(tx, 1, src(), 'waba');
    expect(
      JSON.stringify((b.command(none, '1', undefined) as { components: unknown }).components),
    ).not.toContain('"text":""');
  });

  it('goes to every other engine as the approved text with the same values filled', async () => {
    const { b, tx } = builder({ tpl: template() });
    const p = await b.prepare(tx, 1, src(), 'baileys');
    const c = b.command(p, '1', contact);
    expect(c.type).toBe('text');
    expect((c as { body: string }).body).toBe('Hi Asha, your offer is ready\n\nReply STOP');
  });

  it('refuses, once and with the reason, a template that is gone, no longer approved, paused, or an OTP', async () => {
    const gone = builder({ tpl: undefined });
    await expect(gone.b.prepare(gone.tx, 1, src(), 'waba')).rejects.toThrow(/was deleted/);
    await expect(gone.b.prepare(gone.tx, 1, src({ template_id: null }), 'waba')).rejects.toThrow(
      /was deleted/,
    );

    const rejected = builder({ tpl: template({ metaStatus: 'REJECTED' }) });
    await expect(rejected.b.prepare(rejected.tx, 1, src(), 'waba')).rejects.toThrow(
      /not approved by Meta/,
    );
    // the same template still goes out as text on a personal number
    await expect(rejected.b.prepare(rejected.tx, 1, src(), 'baileys')).resolves.toBeTruthy();

    const otp = builder({ tpl: template({ templateType: 'auth' }) });
    await expect(otp.b.prepare(otp.tx, 1, src(), 'baileys')).rejects.toThrow(/Authentication|OTP/);
    await expect(otp.b.prepare(otp.tx, 1, src(), 'waba')).rejects.toThrow(/Authentication|OTP/);
  });

  it('an unknown kind is refused with a reason rather than sent as something else', async () => {
    const { b, tx } = builder();
    const p = await b.prepare(tx, 1, row({ template_type: 'standard' }), 'baileys');
    expect(() => b.command(p, '1', undefined)).toThrow(/cannot be sent/);
  });
});
