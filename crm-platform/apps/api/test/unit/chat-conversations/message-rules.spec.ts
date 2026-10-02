import { describe, expect, it } from 'vitest';
import { canAdvanceMessageStatus, type MessageStatus } from '@crm/contracts';
import {
  PREVIEW_MAX,
  STATUS_RANK_SQL,
  clampProviderTime,
  decideReceipt,
  failureReason,
  inboundMessageKind,
  kindOfFileMime,
  previewOf,
  windowExpiry,
} from '../../../src/modules/chat-conversations/message-rules';

const STEPS = ['sent', 'delivered', 'read'] as const;
const FROM: MessageStatus[] = ['queued', 'sent', 'delivered', 'read', 'failed'];

describe('receipt rank: a status only moves forward', () => {
  it('queued < sent < delivered < read: every forward step advances, nothing else does', () => {
    const rank = { queued: 0, sent: 1, delivered: 2, read: 3 } as const;
    for (const from of ['queued', 'sent', 'delivered', 'read'] as const) {
      for (const to of STEPS) {
        expect(decideReceipt(from, to).advance, `${from} -> ${to}`).toBe(rank[to] > rank[from]);
      }
    }
  });

  it('failed is reachable only from queued or sent, and never replaces a delivery', () => {
    expect(decideReceipt('queued', 'failed').advance).toBe(true);
    expect(decideReceipt('sent', 'failed').advance).toBe(true);
    expect(decideReceipt('delivered', 'failed').advance).toBe(false);
    expect(decideReceipt('read', 'failed').advance).toBe(false);
    expect(decideReceipt('failed', 'failed').advance).toBe(false);
  });

  it('nothing leaves failed by a receipt: a retry is a new queued attempt, not a receipt', () => {
    for (const to of STEPS) expect(decideReceipt('failed', to).advance).toBe(false);
  });

  it('agrees with the shared rule the web uses (canAdvanceMessageStatus), for every pair', () => {
    for (const from of FROM) {
      for (const to of [...STEPS, 'failed'] as const) {
        expect(decideReceipt(from, to).advance, `${from} -> ${to}`).toBe(
          canAdvanceMessageStatus(from, to),
        );
      }
    }
  });

  it('a receipt the rule refuses still leaves its time behind (delivered after read), except failed, which has no time column', () => {
    expect(decideReceipt('read', 'delivered')).toEqual({
      advance: false,
      backfill: 'delivered_at',
    });
    expect(decideReceipt('delivered', 'sent')).toEqual({ advance: false, backfill: 'sent_at' });
    expect(decideReceipt('read', 'read')).toEqual({ advance: false, backfill: 'read_at' });
    expect(decideReceipt('read', 'failed')).toEqual({ advance: false, backfill: null });
    expect(decideReceipt('queued', 'sent')).toEqual({ advance: true, backfill: null });
  });

  it('every arrival order of the three steps ends at read (out-of-order safe)', () => {
    const orders = [
      ['sent', 'delivered', 'read'],
      ['read', 'delivered', 'sent'],
      ['delivered', 'read', 'sent'],
      ['read', 'sent', 'delivered'],
      ['delivered', 'sent', 'read'],
      ['sent', 'read', 'delivered'],
    ] as const;
    for (const order of orders) {
      let status: MessageStatus = 'queued';
      for (const step of order) if (decideReceipt(status, step).advance) status = step;
      expect(status, order.join(' > ')).toBe('read');
    }
  });

  it('the SQL rank expression names the same four statuses as the rule', () => {
    for (const [status, rank] of [
      ['queued', 0],
      ['sent', 1],
      ['delivered', 2],
      ['read', 3],
    ] as const) {
      expect(STATUS_RANK_SQL).toContain(`WHEN '${status}' THEN ${rank}`);
    }
  });
});

describe('the 24 hour window', () => {
  const t = new Date('2026-10-02T10:00:00.000Z');

  it('expires windowHours after the customer last wrote', () => {
    expect(windowExpiry(24, t)?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    expect(windowExpiry(1, t)?.toISOString()).toBe('2026-10-02T11:00:00.000Z');
  });

  it('is null when the channel has no window rule, or the customer never wrote', () => {
    expect(windowExpiry(null, t)).toBeNull();
    expect(windowExpiry(24, null)).toBeNull();
  });

  it('a provider clock in the future cannot stretch the window past the arrival', () => {
    const arrived = new Date('2026-10-02T10:00:00.000Z');
    expect(clampProviderTime(new Date('2026-10-05T00:00:00.000Z'), arrived)).toEqual(arrived);
    const earlier = new Date('2026-10-02T09:59:00.000Z');
    expect(clampProviderTime(earlier, arrived)).toEqual(earlier);
  });
});

describe('previewOf', () => {
  it('the text, one line, capped', () => {
    expect(previewOf({ kind: 'text', body: '  hello\n  there  ' })).toBe('hello there');
    expect(previewOf({ kind: 'text', body: 'x'.repeat(PREVIEW_MAX + 50) })).toHaveLength(
      PREVIEW_MAX,
    );
  });

  it('a place, a file, a caption: the way Reference labels them', () => {
    expect(previewOf({ kind: 'location', locationName: 'Cafe Coffee Day' })).toBe(
      '📍 Cafe Coffee Day',
    );
    expect(previewOf({ kind: 'location' })).toBe('📍 Location');
    expect(previewOf({ kind: 'image' })).toBe('📎 Image');
    expect(previewOf({ kind: 'document', body: 'invoice attached' })).toBe('invoice attached');
  });

  it('an empty text message has no preview (the list keeps the previous one)', () => {
    expect(previewOf({ kind: 'text', body: '   ' })).toBe('');
  });
});

describe('message kinds', () => {
  it('an inbound delivery is stored under its own kind; what it cannot express becomes text', () => {
    expect(inboundMessageKind({ kind: 'text' })).toBe('text');
    expect(inboundMessageKind({ kind: 'unsupported' })).toBe('text');
    expect(
      inboundMessageKind({
        kind: 'media',
        media: { providerMediaId: 'm', mediaKind: 'audio', mime: 'audio/ogg' },
      }),
    ).toBe('audio');
    expect(inboundMessageKind({ kind: 'location' })).toBe('location');
    expect(inboundMessageKind({ kind: 'reaction' })).toBe('reaction');
  });

  it('an uploaded file is an image, a video, an audio or a document by its mime type', () => {
    expect(kindOfFileMime('image/png')).toBe('image');
    expect(kindOfFileMime('video/mp4')).toBe('video');
    expect(kindOfFileMime('audio/ogg')).toBe('audio');
    expect(kindOfFileMime('application/pdf')).toBe('document');
    expect(kindOfFileMime('text/plain')).toBe('document');
  });

  it('a failure reason is one short line', () => {
    expect(failureReason('  bad\n  thing   happened ')).toBe('bad thing happened');
    expect(failureReason('x'.repeat(900))).toHaveLength(500);
  });
});
