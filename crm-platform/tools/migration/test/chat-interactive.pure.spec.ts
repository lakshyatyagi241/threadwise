import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTurn, replyTitle, sentInteractiveFrom } from '../inbox/parse';
import { previewOf } from '../inbox/peer';
import { elementShapes, repairOf } from '../load/chatreparse';
import { oracleChat } from '../reconcile/oracle-chat';

/** Pure (no database): the interactive elements of a bot reply, the independent oracle, and the chat-reparse rule. Values are invented; shapes are the real ISKM / Rhythm ones. */
const IMG = 'https://files.example.test/a/pic.jpg?sig=1';
const VID = 'https://files.example.test/a/clip.mp4';
const button = (header: unknown, body = 'Pick one', footer: unknown = 'Tap below') => ({
  type: 'whatsapp_interactive',
  interactive: {
    type: 'button',
    header,
    body,
    footer,
    action: {
      buttons: [
        { id: 'b1', type: 'link', value: { text: 'Open', url: 'https://x.example.test/p' } },
        { id: 'b2', type: 'flow', value: { nodeId: 'n', qid: 'q', stage: 's', text: 'Next', url: '' } },
      ],
    },
  },
});
const turn = (el: unknown, br: Record<string, unknown> = { type: 'Flow', subType: 'carousel' }) => ({
  bot_response: { botid: 'b1', ...br, response: [el] },
});

describe('parseTurn: interactive elements', () => {
  it('image header + body + footer: text is the caption body, buttons kept, kind image, file url in legacy', () => {
    const t = parseTurn(turn(button({ type: 'image', link: IMG })));
    expect(t.body).toBe('Pick one\nTap below');
    expect(t.kind).toBe('image');
    expect(t.mediaUrl).toBe(IMG);
    expect(t.legacy.mediaUrl).toBe(IMG);
    const kept = t.legacy.interactive as { action: { buttons: Array<{ id: string }> }; header: unknown; body?: unknown };
    expect(kept.action.buttons.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(kept.header).toEqual({ type: 'image', link: IMG });
    expect(kept.body).toBeUndefined();
    expect(t.empty).toBe(false);
    // the whole payload is still there for a later repair
    expect(JSON.stringify(t.legacy.response)).toContain('whatsapp_interactive');
  });
  it('origin labels (Flow, FAQ) are not message kinds: no UNKNOWN_KIND, the kind comes from the element', () => {
    for (const type of ['Flow', 'FAQ', 'flow']) {
      const t = parseTurn(turn(button(null), { type }));
      expect(t.soft.map((s) => s.code)).not.toContain('UNKNOWN_KIND');
      expect(t.kind).toBe('interactive');
    }
    expect(parseTurn(turn({ type: 'text', value: 'hi' }, { type: 'FAQ' })).kind).toBe('text');
    expect(parseTurn(turn({ type: 'text', value: 'hi' }, { type: 'zzz' })).soft.map((s) => s.code)).toContain('UNKNOWN_KIND');
  });
  it('video / document header; header text; no header; body as {text}; header file sets the kind, no file is interactive', () => {
    const v = parseTurn(turn(button({ type: 'video', link: VID })));
    expect(v.legacy.mediaUrl).toBe(VID);
    expect(v.kind).toBe('video');
    expect(parseTurn(turn(button({ type: 'document', link: IMG }))).kind).toBe('document');
    expect(parseTurn(turn(button({ type: 'text', text: 'T' }))).kind).toBe('interactive');
    expect(parseTurn(turn(button({ type: 'document', link: IMG }))).mediaUrl).toBe(IMG);
    expect(parseTurn(turn(button({ type: 'text', text: 'Title' }))).body).toBe('Title\nPick one\nTap below');
    const bare = parseTurn(turn(button(null, 'Only body', null)));
    expect(bare.body).toBe('Only body');
    expect(bare.mediaUrl).toBeNull();
    expect(parseTurn(turn(button(null, { text: 'Nested' } as never, ''))).body).toBe('Nested');
    const noBody = parseTurn(turn(button({ type: 'image', link: IMG }, '', '')));
    expect(noBody.body).toBeNull();
    expect(noBody.kind).toBe('image');
    expect(noBody.mediaUrl).toBe(IMG);
    expect(noBody.empty).toBe(false);
  });
  it('button urls are not the message file; a non-http header link is ignored', () => {
    const t = parseTurn(turn(button({ type: 'image', link: 'not a url' })));
    expect(t.mediaUrl).toBeNull();
    expect(t.body).toBe('Pick one\nTap below');
  });
  it('type interactive-button-url (rhythm) and an interactive with no body are payloads, never EMPTY_MESSAGE', () => {
    const t = parseTurn(turn({ type: 'interactive-button-url', interactive: { type: 'button', body: 'Go', action: { buttons: [] } } }, { type: 'Flow', subType: 'interactive-button-url' }));
    expect(t).toMatchObject({ body: 'Go', kind: 'interactive', empty: false });
    expect(parseTurn(turn({ type: 'whatsapp_interactive', interactive: { type: 'button', action: {} } })).empty).toBe(false);
  });
  it('share-location: name and address are the text, the maps url is not a file', () => {
    const t = parseTurn(turn({ type: 'share-location', value: { name: 'Temple', address: 'Main Rd', latitude: 1, longitude: 2, url: 'https://maps.example.test/x' } }, { type: 'Flow', subType: 'share-location' }));
    expect(t.body).toBe('Temple\nMain Rd');
    expect(t.mediaUrl).toBeNull();
    expect(t.legacy.location).toEqual({ latitude: 1, longitude: 2 });
  });
  it('an image element keeps the image kind and the url', () => {
    const t = parseTurn(turn({ type: 'image', value: { fileName: 'f', text: 'cap', type: 'image', url: IMG }, text: { url: IMG } }, { type: undefined }));
    expect(t).toMatchObject({ kind: 'image', mediaUrl: IMG });
  });
  it('a blank element is still empty', () => {
    expect(parseTurn({ bot_response: { response: [''] } }).empty).toBe(true);
  });
});

describe('the same turn, read twice, gives the same message (re-run safety)', () => {
  it('deterministic: body, kind, media and the md5 that plan.ts dedupes on are stable; empty is unchanged for payloads', () => {
    const d = turn(button({ type: 'image', link: IMG }));
    const a = parseTurn(d);
    const b = parseTurn(JSON.parse(JSON.stringify(d)));
    const h = (t: typeof a) => createHash('md5').update(`${t.kind}\u0000${t.body ?? ''}\u0000${t.mediaUrl ?? ''}`).digest('hex');
    expect(h(a)).toBe(h(b));
    expect(a.empty).toBe(false); // it was not empty before either (a payload), so it already had its seq and its id_map row
  });
});

describe('oracle follows the same rules, written independently', () => {
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  it('body of interactive and location elements; buttons are not text', async () => {
    const mk = (i: number, el: unknown, extra: Record<string, unknown> = {}) => ({
      _id: `69e4ca40a756f598c23210${10 + i}`,
      createdAt: new Date(`2026-04-19T12:27:${10 + i}.000Z`),
      botid: 'b1',
      channel: 'whatsapp',
      context: {},
      user: { mobile: '919999900001' },
      ...turn(el, extra),
    });
    const docs = [
      mk(0, button({ type: 'image', link: IMG })),
      mk(1, button(null, 'Only body', null)),
      mk(2, button({ type: 'text', text: 'Title' })),
      mk(3, { type: 'share-location', value: { name: 'Temple', address: 'Main Rd', url: 'https://maps.example.test/x' } }),
    ];
    const res = await oracleChat((async function* () { yield* docs; })(), {
      client: 'x',
      botToExt: new Map([['b1', '123']]),
      keepDeletedContactChats: false,
      threadStatus: 'waboo',
      assignAgents: false,
      windowHours: 24,
      referenceAt: '2026-10-09T00:00:00.000Z',
      deletedContacts: new Set(),
      contactId: () => undefined,
      userId: () => undefined,
      hasUsers: false,
      contactsByDigits: new Map(),
      existingThreads: new Map(),
    });
    docs.forEach((d) => {
      const m = res.messages.get(d._id as string)!;
      expect(m.verdict).toBe('load');
      if (m.kind !== undefined) expect(m.kind).toBe(parseTurn(d as never).kind);
      expect(m.bodyMd5).toBe(md5(parseTurn(d as never).body!));
    });
    expect(res.messages.get(docs[1]!._id as string)!.bodyMd5).toBe(md5('Only body'));
  });
});

describe('chat-reparse: repairOf on a saved row', () => {
  const saved = (el: unknown, kind: string, extra: Record<string, unknown> = {}) => ({
    kind,
    meta: { historySync: true, legacy: { src: 'waboo', ctype: 'bot', response: { botid: 'b1', type: 'Flow', response: [el] }, ...extra } },
  });
  it('fills body, kind, mediaUrl and interactive from the saved payload', () => {
    const r = repairOf(saved(button({ type: 'image', link: IMG }), 'interactive'));
    expect(r).toMatchObject({ change: true, body: 'Pick one\nTap below', kind: 'image', unreadable: false });
    expect(r.legacyPatch.mediaUrl).toBe(IMG);
    expect(Object.keys(r.legacyPatch).sort()).toEqual(['interactive', 'mediaUrl']);
  });
  it('is idempotent: a row already carrying mediaUrl and interactive, with the same kind and no text to add, changes nothing', () => {
    const first = repairOf(saved(button({ type: 'image', link: IMG }, '', ''), 'document'));
    expect(first).toMatchObject({ change: true, kind: 'image', body: null });
    const again = repairOf(
      saved(button({ type: 'image', link: IMG }, '', ''), 'image', first.legacyPatch),
    );
    expect(again.change).toBe(false);
    expect(again.unreadable).toBe(false);
  });
  it('a payload with neither text nor file stays unreadable and is described by key sets only', () => {
    const r = repairOf(saved({ foo: 1, bar: { x: 1 } }, 'text'));
    expect(r).toMatchObject({ change: false, unreadable: true, shapes: ['bar,foo'] });
    expect(elementShapes({ response: ['', null, { a: 1 }] })).toEqual(['<string>', '<null>', 'a']);
  });
  it('preview rule: the preview the loader derived from the empty body, and the one after', () => {
    expect(previewOf({ kind: 'interactive', body: null })).toBe('📎 Interactive');
    expect(previewOf({ kind: 'interactive', body: 'Pick one\nTap below' })).toBe('Pick one Tap below');
  });
});

describe('buttons under a message with a header file (F-001)', () => {
  const replyButtons = {
    type: 'whatsapp_interactive',
    interactive: {
      type: 'button',
      header: { type: 'image', link: IMG },
      body: 'This is test bot',
      action: {
        buttons: ['Welcome', 'Feedback', 'No more'].map((t, i) => ({ id: `r${i}`, type: 'reply', reply: { id: `r${i}`, title: t } })),
      },
    },
  };
  it('an image-header button message is kind image and still yields its buttons, in order', () => {
    const t = parseTurn(turn(replyButtons));
    expect(t.kind).toBe('image');
    expect(sentInteractiveFrom(t.legacy.interactive, t.body)).toEqual({
      type: 'buttons',
      body: 'This is test bot',
      buttons: [{ title: 'Welcome' }, { title: 'Feedback' }, { title: 'No more' }],
    });
  });
});

describe('a customer tapping a button or list row is not an empty message', () => {
  it('reads the title from the reply shapes', () => {
    expect(replyTitle({ button_reply: { id: 'r1', title: 'Welcome' } })).toBe('Welcome');
    expect(replyTitle({ interactive: { list_reply: { id: 'x', title: 'Small' } } })).toBe('Small');
    expect(replyTitle({ type: 'button_reply', title: 'No more' })).toBe('No more');
    expect(replyTitle({ foo: 1 })).toBeNull();
  });
  it('user_query_object with an object value / a user_query object', () => {
    const a = parseTurn({ user_query_object: { type: 'interactive', value: { button_reply: { id: 'r1', title: 'Feedback' } } } });
    expect(a.empty).toBe(false);
    expect(a.body).toBe('Feedback');
    const b = parseTurn({ user_query: { interactive: { button_reply: { title: 'Welcome' } } } });
    expect(b.empty).toBe(false);
    expect(b.body).toBe('Welcome');
    expect(b.kind).toBe('interactive');
  });
});

describe('a customer turn with no content', () => {
  it('is kept as a placeholder, flagged, with a soft issue; a bare empty user_query stays empty', () => {
    const t = parseTurn({ user_query_object: { type: 'text', value: '' } });
    expect(t.empty).toBe(false);
    expect(t.direction).toBe('in');
    expect(t.body).toBe('(message content not available)');
    expect(t.legacy.contentUnavailable).toBe(true);
    expect(t.soft.map((x) => x.code)).toContain('CONTENT_UNAVAILABLE');
    expect(parseTurn({ user_query: '' }).empty).toBe(true);
  });
});
