import { describe, expect, it } from 'vitest';
import { VIB_MEDIA_MAX_BYTES } from '@crm/contracts';
import { rowAction, hasReceipts } from './broadcast-model';
import {
  bodyAfterTemplate,
  buttonCount,
  canCreate,
  isAllowedMedia,
  isHttpUrl,
  isMediaSizeOk,
} from './compose-model';
import { peak, pct, segments } from './insights-model';

const tpl = { id: '1', name: 'Offer', body: 'Offer for you', buttons: [] };

describe('bodyAfterTemplate', () => {
  it('fills an empty message and never overwrites typed text', () => {
    expect(bodyAfterTemplate('  ', tpl)).toBe('Offer for you');
    expect(bodyAfterTemplate('mine', tpl)).toBe('mine');
    expect(bodyAfterTemplate('', undefined)).toBe('');
  });
});

describe('buttonCount', () => {
  it('counts the labelled buttons of a template and skips blanks and junk', () => {
    expect(buttonCount([{ text: 'Shop' }, { title: ' Call ' }, { text: '' }, null, 5])).toBe(2);
    expect(buttonCount('nope')).toBe(0);
    expect(buttonCount(undefined)).toBe(0);
  });
});

describe('attachments', () => {
  it('only an http(s) address of a jpg, png, gif or mp4 is accepted; blank means none', () => {
    expect(isAllowedMedia('')).toBe(true);
    expect(isAllowedMedia('https://cdn.test/a.PNG?sig=1')).toBe(true);
    expect(isAllowedMedia('https://cdn.test/a.mp4')).toBe(true);
    expect(isAllowedMedia('https://cdn.test/a.pdf')).toBe(false);
    expect(isAllowedMedia('https://cdn.test/a')).toBe(false);
    expect(isAllowedMedia('ftp://cdn.test/a.png')).toBe(false);
    expect(isAllowedMedia('a.png')).toBe(false);
  });

  it('26 MB is the most; an unknown size is let through', () => {
    expect(isMediaSizeOk(undefined)).toBe(true);
    expect(isMediaSizeOk(VIB_MEDIA_MAX_BYTES)).toBe(true);
    expect(isMediaSizeOk(VIB_MEDIA_MAX_BYTES + 1)).toBe(false);
  });

  it('isHttpUrl accepts only http and https addresses', () => {
    expect(isHttpUrl('https://cdn.test/a.png')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });
});

describe('canCreate', () => {
  const ok = { name: 'Promo', channelId: 'c', body: 'x', mediaUrl: '', selected: new Set(['u1']) };
  it('needs a name, a channel, a user and a message or a file', () => {
    expect(canCreate(ok)).toBe(true);
    expect(canCreate({ ...ok, name: ' ' })).toBe(false);
    expect(canCreate({ ...ok, channelId: '' })).toBe(false);
    expect(canCreate({ ...ok, selected: new Set() })).toBe(false);
    expect(canCreate({ ...ok, body: '' })).toBe(false);
    expect(canCreate({ ...ok, body: '', mediaUrl: 'https://x.test/a.png' })).toBe(true);
  });

  it('a file of a kind Viber does not take blocks the button', () => {
    expect(canCreate({ ...ok, mediaUrl: 'https://x.test/a.pdf' })).toBe(false);
  });
});

describe('the row button', () => {
  it('a draft starts, a sending one pauses, a finished one with failures retries, a clean one has none', () => {
    expect(rowAction({ status: 'draft', failed: 0 })).toBe('start');
    expect(rowAction({ status: 'draft', failed: 3 })).toBe('start');
    expect(rowAction({ status: 'sending', failed: 0 })).toBe('pause');
    expect(rowAction({ status: 'done', failed: 2 })).toBe('retry');
    expect(rowAction({ status: 'failed', failed: 1 })).toBe('retry');
    expect(rowAction({ status: 'done', failed: 0 })).toBeNull();
  });

  it('receipts are shown once Viber has reported one', () => {
    expect(hasReceipts({ delivered: 0, seen: 0 })).toBe(false);
    expect(hasReceipts({ delivered: 1, seen: 0 })).toBe(true);
  });
});

describe('insights numbers', () => {
  it('a rate over nothing is 0, and rounds to a whole percent', () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
  });

  it('the bars are shares of the busiest day; an empty week divides by one', () => {
    const rows = [
      { in: 2, out: 2 },
      { in: 1, out: 0 },
      { in: 0, out: 0 },
    ];
    expect(peak(rows)).toBe(4);
    expect(peak([])).toBe(1);
    expect(segments(rows[0]!, 4)).toEqual({ in: 50, out: 50 });
    expect(segments(rows[2]!, 1)).toEqual({ in: 0, out: 0 });
    expect(segments({ in: 9, out: 0 }, 4)).toEqual({ in: 100, out: 0 });
  });
});
