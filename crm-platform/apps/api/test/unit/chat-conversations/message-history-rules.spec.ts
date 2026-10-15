import { describe, expect, it } from 'vitest';
import {
  MESSAGE_HISTORY_PREVIEW_CHARS,
  listMessageHistoryQuerySchema,
  messageHistoryIdSchema,
} from '@crm/contracts';
import {
  decodeCursor,
  encodeCursor,
  isPhoneLike,
  kpiFigures,
  likeEscape,
  maskRecipient,
  phoneNeedle,
  previewOf,
  previousWindow,
  recipientTimeline,
  resolveWindow,
  safeZone,
  typeFilterParts,
} from '../../../src/modules/chat-conversations/message-history-rules';
import {
  historyCsvLine,
  selectionOfStored,
} from '../../../src/modules/chat-conversations/message-history-export';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const DAY = 86_400_000;

describe('the window a filter means', () => {
  it('a preset is the last N days up to a second after now; no filter is 30 days', () => {
    const w = resolveWindow({ range: '7d' }, NOW);
    if ('problem' in w) throw new Error('unexpected');
    expect(w.to.getTime()).toBe(NOW.getTime() + 1000);
    expect(w.to.getTime() - w.from.getTime()).toBe(7 * DAY + 1000);
    const d = resolveWindow({}, NOW);
    if ('problem' in d) throw new Error('unexpected');
    expect(d.to.getTime() - d.from.getTime()).toBe(30 * DAY + 1000);
    const h = resolveWindow({ range: '24h' }, NOW);
    if ('problem' in h) throw new Error('unexpected');
    expect(h.to.getTime() - h.from.getTime()).toBe(DAY + 1000);
  });

  it('a from/to pair is whole UTC days with the last day included', () => {
    const w = resolveWindow({ from: '2026-10-01', to: '2026-10-03' }, NOW);
    expect(w).toEqual({
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-04T00:00:00.000Z'),
    });
  });

  it('a pair wins over a preset, and one end alone is completed', () => {
    const w = resolveWindow({ range: '7d', from: '2026-10-10' }, NOW);
    expect(w).toEqual({
      from: new Date('2026-10-10T00:00:00.000Z'),
      to: new Date('2026-10-14T00:00:00.000Z'),
    });
  });

  it('refuses a reversed pair, an end in the future and a start more than a year back', () => {
    expect(resolveWindow({ from: '2026-10-05', to: '2026-10-01' }, NOW)).toEqual({
      problem: 'order',
    });
    expect(resolveWindow({ from: '2026-10-01', to: '2026-10-14' }, NOW)).toEqual({
      problem: 'future',
    });
    expect(resolveWindow({ from: '2025-10-12', to: '2026-10-13' }, NOW)).toEqual({
      problem: 'too_old',
    });
    // 365 days back is the oldest day allowed.
    expect('problem' in resolveWindow({ from: '2025-10-13', to: '2026-10-13' }, NOW)).toBe(false);
  });

  it('the previous window is the equal period right before', () => {
    const w = resolveWindow({ range: '7d' }, NOW);
    if ('problem' in w) throw new Error('unexpected');
    const p = previousWindow(w);
    expect(p.to.getTime()).toBe(w.from.getTime());
    expect(p.to.getTime() - p.from.getTime()).toBe(w.to.getTime() - w.from.getTime());
  });
});

describe('masking a recipient', () => {
  it('shows a phone number whole only when the caller may read the contact', () => {
    expect(maskRecipient('919812345678', true)).toEqual({ value: '+919812345678', masked: false });
    expect(maskRecipient('+919812345678', true)).toEqual({ value: '+919812345678', masked: false });
  });

  it('otherwise shows the last four digits and nothing else', () => {
    const m = maskRecipient('919812345678', false);
    expect(m.masked).toBe(true);
    expect(m.value).toMatch(/^•+5678$/);
    expect(m.value).not.toContain('9812');
    // A short number is still hidden beyond its last four.
    expect(maskRecipient('1234567', false).value).toMatch(/^•+4567$/);
  });

  it('leaves a channel id (not a phone number) alone and answers nothing for nothing', () => {
    expect(maskRecipient('t:abc123', false)).toEqual({ value: 't:abc123', masked: false });
    expect(maskRecipient('98765', false)).toEqual({ value: '98765', masked: false });
    expect(maskRecipient(null, false)).toEqual({ value: null, masked: false });
    expect(maskRecipient('', true)).toEqual({ value: null, masked: false });
  });

  it('knows a phone number from an id', () => {
    expect(isPhoneLike('919812345678')).toBe(true);
    expect(isPhoneLike('+919812345678')).toBe(true);
    expect(isPhoneLike('12345')).toBe(false);
    expect(isPhoneLike('t:1234567')).toBe(false);
    expect(isPhoneLike(null)).toBe(false);
  });
});

describe('the text preview', () => {
  it('keeps the first 40 characters on one line and marks the cut', () => {
    const long = 'a'.repeat(100);
    const p = previewOf(long)!;
    expect(Array.from(p)).toHaveLength(MESSAGE_HISTORY_PREVIEW_CHARS + 1);
    expect(p.endsWith('…')).toBe(true);
    expect(previewOf('hello\n\n  world')).toBe('hello world');
    expect(previewOf('x'.repeat(40))).toBe('x'.repeat(40));
  });

  it('cuts on characters, not on UTF-16 halves', () => {
    const p = previewOf('😀'.repeat(50))!;
    expect(Array.from(p)).toHaveLength(MESSAGE_HISTORY_PREVIEW_CHARS + 1);
  });

  it('has no preview for no text', () => {
    expect(previewOf(null)).toBeNull();
    expect(previewOf('   \n ')).toBeNull();
  });
});

describe('search terms', () => {
  it('takes a number out of a phone-looking term only', () => {
    expect(phoneNeedle('+91 98123-456')).toBe('9198123456');
    expect(phoneNeedle('12')).toBeNull();
    expect(phoneNeedle('order 12345')).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('the KPI cards', () => {
  const counts = {
    total: 15,
    queued: 1,
    sentStatus: 3,
    delivered: 2,
    read: 2,
    failed: 2,
    received: 5,
  };

  it("follow Reference's definitions: sent excludes failed, failPct is relative to sent", () => {
    const k = kpiFigures(
      { total: 15, queued: 0, sentStatus: 8, delivered: 0, read: 0, failed: 2, received: 5 },
      10,
    );
    // Reference acceptance: 8 sent + 2 failed + 5 received -> Total 15, failPct 25.0 of the 8 sent.
    expect(k.total).toBe(15);
    expect(k.sent).toBe(8);
    expect(k.received).toBe(5);
    expect(k.failed).toBe(2);
    expect(k.failPct).toBe(25);
    expect(k.sentPct).toBe(53);
    expect(k.receivedPct).toBe(33);
    expect(k.deltaPct).toBe(50);
  });

  it('counts delivered as delivered or read and the rate over what left the queue', () => {
    const k = kpiFigures(counts, 0);
    // outbound = 1 + 3 + 2 + 2 + 2 = 10; left the queue = 9; delivered or read = 4.
    expect(k.sent).toBe(8);
    expect(k.queued).toBe(1);
    expect(k.delivered).toBe(4);
    expect(k.read).toBe(2);
    expect(k.deliveryRate).toBe(44.4);
    expect(k.dirCounts).toEqual({ all: 15, out: 10, in: 5, fail: 2 });
  });

  it('has no delivery rate when nothing left the queue, and no division by zero', () => {
    const k = kpiFigures(
      { total: 2, queued: 2, sentStatus: 0, delivered: 0, read: 0, failed: 0, received: 0 },
      0,
    );
    expect(k.deliveryRate).toBeNull();
    expect(k.failPct).toBe(0);
    const z = kpiFigures(
      { total: 0, queued: 0, sentStatus: 0, delivered: 0, read: 0, failed: 0, received: 0 },
      0,
    );
    expect(z.sentPct).toBe(0);
    expect(z.deltaPct).toBe(0);
  });

  it('the change against a previous period of 0 is 100 when there is traffic, else 0', () => {
    expect(kpiFigures({ ...counts }, 0).deltaPct).toBe(100);
    expect(kpiFigures({ ...counts, total: 0 }, 0).deltaPct).toBe(0);
    expect(kpiFigures({ ...counts, total: 5 }, 10).deltaPct).toBe(-50);
  });
});

describe('the type filter', () => {
  it('maps the automated sources to themselves and the rest to message kinds', () => {
    expect(typeFilterParts('broadcast')).toEqual({ entity: 'broadcast', source: 'broadcast' });
    expect(typeFilterParts('auto_reply')).toEqual({ source: 'auto_reply' });
    expect(typeFilterParts('audio').kinds).toEqual(['audio', 'voice']);
    expect(typeFilterParts('document').kinds).toEqual(['document', 'sticker']);
    expect(typeFilterParts('location').kinds).toEqual(['location']);
  });
});

describe('the cursor', () => {
  it('survives a round trip, with microseconds', () => {
    const c = { at: '2026-10-13T11:59:59.123456Z', rank: 2, id: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('rejects anything that is not one', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('["2026-10-13",0,1]').toString('base64url'))).toBeNull();
    expect(
      decodeCursor(Buffer.from('["2026-10-13T10:00:00Z",12,1]').toString('base64url')),
    ).toBeNull();
    expect(
      decodeCursor(Buffer.from('["2026-10-13T10:00:00Z; DROP",0,1]').toString('base64url')),
    ).toBeNull();
  });
});

describe('time zones', () => {
  it('accepts a zone Intl knows and falls back to UTC', () => {
    expect(safeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(safeZone('Mars/Olympus')).toBe('UTC');
    expect(safeZone(undefined)).toBe('UTC');
    expect(safeZone("UTC'; DROP")).toBe('UTC');
  });
});

describe('the timeline of a recipient row', () => {
  it('lists the moments the row recorded, oldest first, with the failure on the failed line', () => {
    const t = recipientTimeline({
      created_at: '2026-10-13T10:00:00.000Z',
      sent_at: '2026-10-13T10:00:05.000Z',
      delivered_at: null,
      read_at: null,
      failed_at: '2026-10-13T10:00:09.000Z',
      fail_code: '131049',
      fail_reason: 'Meta chose not to deliver',
      provider_id: 'wamid.X',
    });
    expect(t.map((e) => e.event)).toEqual(['queued', 'sent', 'failed']);
    expect(t[2]).toMatchObject({ errorCode: '131049', errorMessage: 'Meta chose not to deliver' });
    expect(t[0]!.providerMessageId).toBeNull();
    expect(t[1]!.providerMessageId).toBe('wamid.X');
  });

  it('a read row shows queued, sent, delivered and read', () => {
    const t = recipientTimeline({
      created_at: '2026-10-13T10:00:00.000Z',
      sent_at: '2026-10-13T10:00:01.000Z',
      delivered_at: '2026-10-13T10:00:02.000Z',
      read_at: '2026-10-13T10:00:03.000Z',
    });
    expect(t.map((e) => e.event)).toEqual(['queued', 'sent', 'delivered', 'read']);
    expect(t.map((e) => e.source)).toEqual(['system', 'system', 'provider', 'provider']);
  });
});

describe('the filters of a request', () => {
  it('reads a comma list of sources and refuses an unknown one', () => {
    const ok = listMessageHistoryQuerySchema.parse({ source: 'flow,ai', limit: '10' });
    expect(ok.source).toEqual(['flow', 'ai']);
    expect(ok.limit).toBe(10);
    expect(listMessageHistoryQuerySchema.safeParse({ source: 'flow,nope' }).success).toBe(false);
  });

  it('refuses a made-up key, an oversize page and a bad status', () => {
    expect(listMessageHistoryQuerySchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(listMessageHistoryQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(listMessageHistoryQuerySchema.safeParse({ status: 'received' }).success).toBe(false);
    expect(listMessageHistoryQuerySchema.safeParse({}).data?.limit).toBe(25);
  });

  it('a row id is a table letter and a uuid', () => {
    const u = '0b6f6c2e-7a3d-4a0e-9c1e-2f6f6d9a1b11';
    expect(messageHistoryIdSchema.safeParse(`m:${u}`).success).toBe(true);
    expect(messageHistoryIdSchema.safeParse(`s:${u}`).success).toBe(true);
    expect(messageHistoryIdSchema.safeParse(`x:${u}`).success).toBe(false);
    expect(messageHistoryIdSchema.safeParse(u).success).toBe(false);
  });
});

describe('the export file', () => {
  it('prefixes a cell a spreadsheet would run as a formula', () => {
    const line = historyCsvLine({
      entity_kind: 'message',
      uid: 'u1',
      source: 'inbox',
      at_text: '2026-10-13T10:00:00.123456Z',
      direction: 'in',
      phone: '919812345678',
      contact_name: '=cmd|calc',
      status: 'received',
      type: 'text',
      body: '+SUM(1,1)',
      channel_name: 'Main',
      template_name: null,
      entity_name: null,
      fail_code: null,
      fail_reason: null,
    });
    expect(line).toContain("'=cmd|calc");
    expect(line).toContain('"\'+SUM(1,1)"');
    expect(line.startsWith('m:u1,inbox,2026-10-13T10:00:00.123Z,in,919812345678,')).toBe(true);
  });

  it('reads the stored window and filters back into a selection', () => {
    const sel = selectionOfStored({
      window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
      dir: 'fail',
      source: ['flow'],
      q: 'x',
    });
    expect(sel.window.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(sel.narrow).toEqual({ dir: 'fail', source: ['flow'], q: 'x' });
    expect(() => selectionOfStored({})).toThrow();
    expect(() => selectionOfStored(null)).toThrow();
  });
});
