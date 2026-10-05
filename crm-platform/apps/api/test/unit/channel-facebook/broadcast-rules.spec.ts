import { describe, expect, it } from 'vitest';
import {
  WINDOW_HOURS,
  insideWindow,
  isUnreachable,
  messengerButtons,
  personalise,
  progressPct,
  psidOf,
  windowCutoff,
} from '../../../src/modules/channel-facebook/broadcast-rules';

const NOW = new Date('2026-10-02T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('the 24 hour window (TW-FB-012, 013)', () => {
  it('the cutoff is 24 hours back and a person is inside it up to the second', () => {
    expect(WINDOW_HOURS).toBe(24);
    expect(windowCutoff(NOW).toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(insideWindow(ago(1), NOW)).toBe(true);
    expect(insideWindow(ago(24), NOW)).toBe(true);
    expect(insideWindow(new Date(ago(24).getTime() - 1), NOW)).toBe(false);
    expect(insideWindow(ago(48), NOW)).toBe(false);
  });

  it('a thread that never received a message is not inside it', () => {
    expect(insideWindow(null, NOW)).toBe(false);
  });
});

describe('who cannot be reached (TW-FB-013)', () => {
  it('outside the window, unavailable, invalid id, development mode and policy are blocked', () => {
    for (const e of [
      '(#10) This message is sent outside of the allowed window.',
      'Outside the allowed window',
      "(#551) This person isn't available right now.",
      'No matching user found',
      'Invalid user id',
      'Cannot message users who are not admins, developers or testers of the app',
      '(#200) Requires pages_messaging permission; policy violation',
    ]) {
      expect(isUnreachable(e), e).toBe(true);
    }
  });

  it('a transient or unknown refusal is a failure that a retry can fix', () => {
    for (const e of [
      'Facebook could not be reached',
      'An unknown error occurred',
      'Rate limit hit',
      '',
    ]) {
      expect(isUnreachable(e), e).toBe(false);
    }
  });
});

describe('personalising and progress (TW-FB-012)', () => {
  it('{{name}}, {{ name }} and {name} become the name; a missing name leaves nothing', () => {
    expect(personalise('Hi {{name}}, hi {{ name }}, hi {name}!', 'Asha')).toBe(
      'Hi Asha, hi Asha, hi Asha!',
    );
    expect(personalise('Hi {{name}}', null)).toBe('Hi');
    expect(personalise('  {other} stays  ', 'Asha')).toBe('{other} stays');
  });

  it('progress is whole percent, blocked counts as done, an empty broadcast is 0', () => {
    expect(progressPct(1, 1, 1, 6)).toBe(50);
    expect(progressPct(0, 0, 0, 0)).toBe(0);
    expect(progressPct(3, 0, 0, 3)).toBe(100);
    expect(progressPct(1, 0, 0, 3)).toBe(33);
  });
});

describe('a template’s buttons as Messenger buttons (TW-FB-013)', () => {
  it('a link, a phone number and a quick reply map to web_url, phone_number and a tqr postback', () => {
    expect(
      messengerButtons([
        { type: 'url', text: 'Shop', url: 'https://x.test' },
        { type: 'phone', title: 'Call', phone_number: '+911234567890' },
        { type: 'quick_reply', text: 'Yes' },
      ]),
    ).toEqual([
      { type: 'web_url', title: 'Shop', url: 'https://x.test' },
      { type: 'phone_number', title: 'Call', payload: '+911234567890' },
      { type: 'postback', title: 'Yes', payload: 'tqr:Yes' },
    ]);
  });

  it('only the first three are looked at, titles are cut to 20, and the payload keeps the full title', () => {
    const long = 'A very long button title indeed';
    const out = messengerButtons([{ text: long }, { text: 'b' }, { text: 'c' }, { text: 'd' }]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'postback', title: long.slice(0, 20), payload: `tqr:${long}` });
  });

  it('a button without a title, a link without an address and a phone without a number are skipped or become a tap', () => {
    expect(messengerButtons([{ type: 'url' }, { text: '' }])).toEqual([]);
    // A link with no address is not a link: it is sent as a tap, as Reference did.
    expect(messengerButtons([{ type: 'url', text: 'Shop' }])).toEqual([
      { type: 'postback', title: 'Shop', payload: 'tqr:Shop' },
    ]);
    expect(messengerButtons([{ type: 'phone', text: 'Call' }])).toEqual([
      { type: 'postback', title: 'Call', payload: 'tqr:Call' },
    ]);
    expect(messengerButtons([])).toEqual([]);
    expect(messengerButtons([null, 5, 'x'])).toEqual([]);
  });
});

describe('the person in a thread key (TW-FB-012)', () => {
  it('a Messenger thread has a person; a comment thread and anything else do not', () => {
    expect(psidOf('fb:P1:555')).toBe('555');
    expect(psidOf('fb:P1:post:P1_77:555')).toBeNull();
    expect(psidOf('fb:P1:post')).toBeNull();
    expect(psidOf('tg:1:2')).toBeNull();
    expect(psidOf('fb:P1:')).toBeNull();
  });
});
