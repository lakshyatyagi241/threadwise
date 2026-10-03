import { describe, expect, it } from 'vitest';
import {
  keywordMatches,
  readComment,
  readEntries,
  readHistory,
  readMessaging,
} from '../../../src/modules/channel-facebook/event-rules';

describe('reading a webhook payload (TW-FB-006)', () => {
  it('only object = page is ours, and every entry of a batch is read', () => {
    expect(readEntries({ object: 'instagram', entry: [{ id: '1' }] })).toEqual([]);
    expect(readEntries(null)).toEqual([]);
    const out = readEntries({
      object: 'page',
      entry: [
        {
          id: 'P1',
          messaging: [{ a: 1 }],
          changes: [
            { field: 'feed', value: { item: 'comment' } },
            { field: 'mention', value: {} },
          ],
        },
        { id: '' },
        { id: 'P2' },
      ],
    });
    expect(out.map((e) => e.pageId)).toEqual(['P1', 'P2']);
    expect(out[0]?.messaging).toHaveLength(1);
    expect(out[0]?.feed).toEqual([{ item: 'comment' }]);
    expect(out[1]).toEqual({ pageId: 'P2', messaging: [], feed: [] });
  });
});

describe('a Messenger event (TW-FB-007, 008)', () => {
  const dm = (message: object, extra: object = {}) => ({
    sender: { id: '555' },
    timestamp: 1700000000000,
    message,
    ...extra,
  });

  it('a customer message carries text, id and time', () => {
    expect(readMessaging(dm({ mid: 'm1', text: 'hello' }))).toEqual({
      kind: 'dm',
      dm: {
        psid: '555',
        mid: 'm1',
        text: 'hello',
        mediaType: null,
        mediaUrl: null,
        timestamp: 1700000000000,
      },
    });
  });

  it('the first attachment sets the media; a file without a url keeps its type and no address', () => {
    const r = readMessaging(
      dm({
        mid: 'm',
        attachments: [{ type: 'image', payload: { url: 'https://x/a.jpg' } }, { type: 'video' }],
      }),
    );
    expect(r).toMatchObject({
      kind: 'dm',
      dm: { mediaType: 'image', mediaUrl: 'https://x/a.jpg', text: '' },
    });
    expect(readMessaging(dm({ mid: 'm', attachments: [{ payload: {} }] }))).toMatchObject({
      dm: { mediaType: 'file', mediaUrl: null },
    });
  });

  it('echoes, receipts and messages without a sender or an id are ignored', () => {
    expect(readMessaging(dm({ mid: 'm', is_echo: true, text: 'ours' }))).toEqual({
      kind: 'ignore',
    });
    expect(readMessaging({ sender: { id: '555' }, delivery: { mids: ['m'] } })).toEqual({
      kind: 'ignore',
    });
    expect(readMessaging({ sender: {}, message: { mid: 'm', text: 'x' } })).toEqual({
      kind: 'ignore',
    });
    expect(readMessaging(dm({ text: 'no id' }))).toEqual({ kind: 'ignore' });
  });

  it('a tap is a postback with its payload, else its title, and is never a message', () => {
    expect(
      readMessaging({
        sender: { id: '555' },
        postback: { payload: 'GET_STARTED', title: 'Start' },
      }),
    ).toEqual({
      kind: 'postback',
      postback: { psid: '555', payload: 'GET_STARTED' },
    });
    expect(readMessaging({ sender: { id: '555' }, postback: { title: 'Menu' } })).toMatchObject({
      postback: { payload: 'Menu' },
    });
    expect(readMessaging({ sender: { id: '555' }, postback: {} })).toEqual({ kind: 'ignore' });
    // A postback wins even if a message is present: the tap must reach the flow before the message guard.
    expect(
      readMessaging({ sender: { id: '5' }, postback: { payload: 'P' }, message: { mid: 'm' } }),
    ).toMatchObject({ kind: 'postback' });
  });
});

describe('a feed comment (TW-FB-009)', () => {
  const add = (o: object = {}) => ({
    item: 'comment',
    verb: 'add',
    comment_id: 'c1',
    post_id: 'P1_77',
    from: { id: '555', name: 'Asha' },
    message: 'nice',
    ...o,
  });

  it('a new comment is read with its post, author and text', () => {
    expect(readComment('P1', add())).toEqual({
      commentId: 'c1',
      postId: 'P1_77',
      fromId: '555',
      fromName: 'Asha',
      parentId: '',
      message: 'nice',
    });
  });

  it('the post id falls back to the parent id', () => {
    expect(readComment('P1', add({ post_id: undefined, parent_id: 'P1_88' }))).toMatchObject({
      postId: 'P1_88',
      parentId: 'P1_88',
    });
  });

  it('anything but a new comment, a missing id and the Page’s own comment are dropped', () => {
    expect(readComment('P1', add({ verb: 'edited' }))).toBeNull();
    expect(readComment('P1', add({ item: 'reaction' }))).toBeNull();
    expect(readComment('P1', add({ comment_id: '' }))).toBeNull();
    expect(readComment('P1', add({ post_id: undefined }))).toBeNull();
    expect(readComment('P1', add({ from: { id: 'P1', name: 'Page' } }))).toBeNull();
    expect(readComment('P1', add({ from: undefined }))).toMatchObject({ fromId: '', fromName: '' });
  });
});

describe('which text starts a flow (TW-FB-007 rule 8)', () => {
  it('any token may match, ignoring case, by containing', () => {
    expect(keywordMatches('Where is my ORDER', 'hello, order , track')).toBe(true);
    expect(keywordMatches('hi', 'hello,order')).toBe(false);
  });

  it('a catch-all token matches any message but never an empty one', () => {
    for (const kw of ['any', '*', '.*', '.+', 'x, ANY'])
      expect(keywordMatches('whatever', kw)).toBe(true);
    expect(keywordMatches('  ', 'any')).toBe(false);
    expect(keywordMatches('hi', '')).toBe(false);
    expect(keywordMatches('hi', null)).toBe(false);
    expect(keywordMatches('hi', ' , ,')).toBe(false);
  });
});

describe('history from Meta (TW-FB-010)', () => {
  it('a customer message is read with its media and time', () => {
    expect(
      readHistory('P1', {
        id: 'm1',
        message: 'hello',
        created_time: '2026-01-02T03:04:05+0000',
        from: { id: '555' },
        attachments: { data: [{ mime_type: 'image/png', image_data: { url: 'https://x/i.png' } }] },
      }),
    ).toEqual({
      mid: 'm1',
      text: 'hello',
      mediaType: 'image',
      mediaUrl: 'https://x/i.png',
      fromId: '555',
      timestamp: Date.parse('2026-01-02T03:04:05+0000'),
    });
  });

  it('the Page’s own replies, empty messages and ones without an id are not imported', () => {
    expect(readHistory('P1', { id: 'm', message: 'ours', from: { id: 'P1' } })).toBeNull();
    expect(readHistory('P1', { id: 'm', message: '', from: { id: '555' } })).toBeNull();
    expect(readHistory('P1', { message: 'x', from: { id: '555' } })).toBeNull();
    expect(readHistory('P1', { id: 'm', message: 'x' })).toBeNull();
  });

  it('a video or a plain file is typed by its mime, and a bad time is null', () => {
    const v = readHistory('P1', {
      id: 'm',
      from: { id: '5' },
      created_time: 'bad',
      attachments: { data: [{ mime_type: 'video/mp4', video_data: { url: 'https://x/v' } }] },
    });
    expect(v).toMatchObject({ mediaType: 'video', timestamp: null });
    const f = readHistory('P1', {
      id: 'm',
      from: { id: '5' },
      attachments: { data: [{ mime_type: 'application/pdf', file_url: 'https://x/f.pdf' }] },
    });
    expect(f).toMatchObject({ mediaType: 'file', mediaUrl: 'https://x/f.pdf', text: '' });
  });
});
