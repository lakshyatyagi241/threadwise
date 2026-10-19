import { describe, expect, it, vi } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import {
  buttonTypeOf,
  previewButtonsOf,
  previewHeaderOf,
  templatePreviewOf,
} from '../../../src/modules/team-inbox-conversations/inbox-template-rules';
import { InboxThreadService } from '../../../src/modules/team-inbox-conversations/inbox-thread.service';
import type { TemplateRow } from '../../../src/modules/message-templates';
import {
  headerPreviewUrl,
  storedHeaderUrl,
} from '../../../src/modules/message-templates/template-media';

describe('template header link', () => {
  const link = async (key: string) => `https://files.example/${key}`;
  const row = (over: Partial<TemplateRow>) => over as TemplateRow;

  it('links the stored upload first, then the channel sample when no stored link is made', async () => {
    const keyed = row({
      attachmentType: 'video',
      headerMediaKey: 'template-media/1/a.mp4',
      headerSampleUrl: 'https://cdn.example/s.mp4',
    });
    expect(await headerPreviewUrl(link, keyed)).toBe(
      'https://files.example/template-media/1/a.mp4',
    );
    // Local disk gives no link for a stored file: the sample is the fallback.
    expect(await headerPreviewUrl(async () => null, keyed)).toBe('https://cdn.example/s.mp4');
  });

  it('uses a sample only when it is a web address', async () => {
    const withSample = (sample: string | null) =>
      row({ attachmentType: 'image', headerMediaKey: null, headerSampleUrl: sample });
    expect(await headerPreviewUrl(link, withSample('https://cdn.example/s.jpg'))).toBe(
      'https://cdn.example/s.jpg',
    );
    expect(await headerPreviewUrl(link, withSample('javascript:alert(1)'))).toBeNull();
    expect(await headerPreviewUrl(link, withSample(null))).toBeNull();
  });

  it('gives a location pin no file link, even with a stored key or sample', async () => {
    expect(
      await headerPreviewUrl(
        link,
        row({
          attachmentType: 'location',
          headerMediaKey: 'template-media/1/x',
          headerSampleUrl: 'https://cdn.example/x',
        }),
      ),
    ).toBeNull();
  });

  it('asks the storage linker only for a stored key', async () => {
    const asked: string[] = [];
    const spy = async (key: string) => {
      asked.push(key);
      return 'https://files.example/x';
    };
    expect(await storedHeaderUrl(spy, row({ headerMediaKey: null }))).toBeNull();
    expect(asked).toEqual([]);
    expect(await storedHeaderUrl(spy, row({ headerMediaKey: 'template-media/1/x' }))).toBe(
      'https://files.example/x',
    );
    expect(asked).toEqual(['template-media/1/x']);
  });
});

describe('template preview: the pieces', () => {
  it('names a button kind, treating an OTP button as copy code and anything unknown as other', () => {
    expect(buttonTypeOf('QUICK_REPLY')).toBe('quick_reply');
    expect(buttonTypeOf('url')).toBe('url');
    expect(buttonTypeOf('PHONE_NUMBER')).toBe('phone');
    expect(buttonTypeOf('COPY_CODE')).toBe('copy_code');
    expect(buttonTypeOf('OTP')).toBe('copy_code');
    expect(buttonTypeOf('FLOW')).toBe('other');
    expect(buttonTypeOf(undefined)).toBe('other');
  });

  it('reads loose button JSON in order and drops what is not a button', () => {
    expect(
      previewButtonsOf([
        { type: 'QUICK_REPLY', text: 'Yes' },
        null,
        'x',
        { type: 'URL', text: 'Track', url: 'https://example.com/{{1}}' },
        { type: 'COPY_CODE' },
      ]),
    ).toEqual([
      { type: 'quick_reply', text: 'Yes' },
      { type: 'url', text: 'Track' },
      { type: 'copy_code', text: '' },
    ]);
    // A fixed link and a call number travel with the button; a link with a `{{n}}` does not (its final address is not known here).
    expect(
      previewButtonsOf([
        { type: 'URL', text: 'Visit', url: 'https://example.com' },
        { type: 'URL', text: 'Track', url: 'https://example.com/{{1}}' },
        { type: 'PHONE_NUMBER', text: 'Call', phone_number: ' +15550100100 ' },
      ]),
    ).toEqual([
      { type: 'url', text: 'Visit', url: 'https://example.com' },
      { type: 'url', text: 'Track' },
      { type: 'phone', text: 'Call', phone: '+15550100100' },
    ]);
    expect(previewButtonsOf(null)).toEqual([]);
    expect(previewButtonsOf({})).toEqual([]);
  });

  it('draws the header as a media marker, else its text, else nothing', () => {
    expect(previewHeaderOf({ attachmentType: 'image', header: 'ignored' })).toEqual({
      format: 'image',
      text: null,
    });
    expect(previewHeaderOf({ attachmentType: 'LOCATION', header: null })?.format).toBe('location');
    expect(previewHeaderOf({ attachmentType: 'none', header: ' Order shipped ' })).toEqual({
      format: 'text',
      text: 'Order shipped',
    });
    expect(previewHeaderOf({ attachmentType: null, header: '  ' })).toBeNull();
  });

  it('carries the header file link only when the caller has one', () => {
    expect(previewHeaderOf({ attachmentType: 'video', header: null }, FILE_URL)).toEqual({
      format: 'video',
      text: null,
      mediaUrl: FILE_URL,
    });
    expect(previewHeaderOf({ attachmentType: 'video', header: null }, null)).toEqual({
      format: 'video',
      text: null,
    });
    // A location pin has no file, so no link is passed for it and none is drawn.
    expect(previewHeaderOf({ attachmentType: 'location', header: null }, null)).toEqual({
      format: 'location',
      text: null,
    });
  });

  it('carries no file locator for a media header, and a blank footer is none', () => {
    const p = templatePreviewOf({
      attachmentType: 'document',
      header: null,
      footer: '  ',
      buttons: [],
    });
    expect(p).toEqual({ header: { format: 'document', text: null }, footer: null, buttons: [] });
  });
});

const ctx: RequestContext = { requestId: 'r', orgId: 1, actorType: 'user', actorId: 5, userId: 5 };
const A = '8a1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e11';
const B = '8a1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e12';
const GONE = '8a1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e13';
const FILE_URL = 'https://files.example/header.mp4';

const row = (uuid: string, over: Partial<TemplateRow> = {}): TemplateRow =>
  ({
    uuid,
    header: 'Hello',
    footer: 'Reply STOP to opt out',
    buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
    attachmentType: 'none',
    ...over,
  }) as TemplateRow;

const msg = (id: string, templateId: string | null, kind = 'template'): MessageResponse =>
  ({
    id,
    kind,
    body: 'rendered',
    template: kind === 'template' ? { templateId, name: 'n', language: 'en', variables: {} } : null,
  }) as MessageResponse;

function setup(
  page: MessageResponse[],
  linkerOf: (r: TemplateRow) => Promise<string | null> = async (r) =>
    r.uuid === B ? FILE_URL : null,
) {
  const findManyByUuids = vi.fn(async (_tx: unknown, _org: number, uuids: readonly string[]) =>
    [row(A), row(B, { header: null, attachmentType: 'video' })].filter((r) =>
      uuids.includes(r.uuid),
    ),
  );
  const service = new InboxThreadService(
    { tx: (fn: (t: unknown) => unknown) => fn({}) } as never,
    { recordByUuid: async () => ({ id: 1 }) } as never,
    { viewer: async () => ({}), assertVisible: () => undefined } as never,
    {} as never,
    {} as never,
    { findManyByUuids } as never,
    {} as never,
    {
      listMessages: async () => ({
        data: page,
        page: { hasMoreBefore: false, hasMoreAfter: false, limit: 50 },
      }),
    } as never,
    { previewLinker: async () => linkerOf } as never,
  );
  const read = () =>
    RequestContextStore.run(ctx, () => service.listMessages('conv', { limit: 50 } as never));
  return { read, findManyByUuids };
}

describe('InboxThreadService: template previews on a thread page', () => {
  it('resolves every template of the page in one query, once per distinct template', async () => {
    const { read, findManyByUuids } = setup([
      msg('1', A),
      msg('2', B),
      msg('3', A),
      msg('4', null, 'text'),
    ]);
    const { data } = await read();
    expect(findManyByUuids).toHaveBeenCalledTimes(1);
    expect(findManyByUuids.mock.calls[0]![2]).toEqual([A, B]);
    expect(data[0]!.template!.preview).toEqual({
      header: { format: 'text', text: 'Hello' },
      footer: 'Reply STOP to opt out',
      buttons: [{ type: 'quick_reply', text: 'Yes' }],
    });
    expect(data[1]!.template!.preview!.header).toEqual({
      format: 'video',
      text: null,
      mediaUrl: FILE_URL,
    });
    expect(data[0]!.template!.preview!.header).not.toHaveProperty('mediaUrl');
    expect(data[2]!.template!.preview).toEqual(data[0]!.template!.preview);
    expect(data[3]!.template).toBeNull();
  });

  it('keeps the page and drops only the link when a header link cannot be made', async () => {
    const { read } = setup([msg('1', A), msg('2', B)], async (r) => {
      if (r.uuid === B) throw new Error('settings unreadable');
      return null;
    });
    const { data } = await read();
    expect(data[0]!.template!.preview!.header).toEqual({ format: 'text', text: 'Hello' });
    expect(data[1]!.template!.preview!.header).toEqual({ format: 'video', text: null });
  });

  it('leaves a message whose template is gone, or was never linked, without a preview', async () => {
    const { read } = setup([msg('1', GONE), msg('2', null)]);
    const { data } = await read();
    expect(data[0]!.template!.preview).toBeUndefined();
    expect(data[1]!.template!.preview).toBeUndefined();
    expect(data[0]!.body).toBe('rendered');
  });

  it('does not touch the templates when the page has no template message', async () => {
    const { read, findManyByUuids } = setup([msg('1', null, 'text')]);
    await read();
    expect(findManyByUuids).not.toHaveBeenCalled();
  });
});
