import { describe, expect, it } from 'vitest';
import {
  BUTTON_LIMITS,
  addableKinds,
  buttonIssues,
  buttonToRow,
  EDITOR_BUTTON_MAX,
  MODE_KINDS,
  canAdd,
  modeOf,
  moveRow,
  newRow,
  rowToButton,
} from './buttons';

const row = (kind: Parameters<typeof newRow>[0], p: Partial<ReturnType<typeof newRow>> = {}) => ({
  ...newRow(kind),
  ...p,
});

describe('button limits', () => {
  it('matches Meta: 10 in all, 10 quick replies, 2 URLs, 1 phone, 1 copy code', () => {
    expect(BUTTON_LIMITS).toEqual({ total: 10, quick_reply: 10, url: 2, phone: 1, copy_code: 1 });
  });

  it('stops adding a kind at its limit', () => {
    const rows = [row('url'), row('url'), row('phone')];
    expect(canAdd(rows, 'url')).toBe(false);
    expect(canAdd(rows, 'phone')).toBe(false);
    expect(canAdd(rows, 'quick_reply')).toBe(true);
    expect(addableKinds(rows)).toEqual(['quick_reply', 'copy_code']);
  });

  it('stops everything at ten buttons', () => {
    const rows = Array.from({ length: 10 }, () => row('quick_reply'));
    expect(addableKinds(rows)).toEqual([]);
  });
});

describe('button rows and the API shape', () => {
  it('maps each kind to the stored button', () => {
    expect(rowToButton(row('quick_reply', { text: ' Yes ' }))).toEqual({
      type: 'QUICK_REPLY',
      text: 'Yes',
    });
    expect(rowToButton(row('url', { text: 'Shop', url: 'https://x.test/a' }))).toEqual({
      type: 'URL',
      text: 'Shop',
      url: 'https://x.test/a',
    });
    expect(
      rowToButton(row('url', { text: 'Shop', url: 'https://x.test/{{1}}', example: 'abc' })),
    ).toMatchObject({
      example: 'abc',
    });
    expect(rowToButton(row('phone', { text: 'Call', phone: '+15551234567' }))).toEqual({
      type: 'PHONE_NUMBER',
      text: 'Call',
      phone_number: '+15551234567',
    });
    expect(rowToButton(row('copy_code', { example: 'PROMO50' }))).toEqual({
      type: 'COPY_CODE',
      example: 'PROMO50',
    });
  });

  it('reads stored buttons back, and keeps a type it does not author', () => {
    expect(buttonToRow({ type: 'URL', text: 'Shop', url: 'https://x.test' }).kind).toBe('url');
    expect(buttonToRow({ type: 'quick_reply', text: 'Hi' }).kind).toBe('quick_reply');
    const flow = { type: 'FLOW', text: 'Open', flow_id: '1' };
    const r = buttonToRow(flow);
    expect(r.kind).toBe('other');
    expect(rowToButton(r)).toEqual(flow);
  });

  it('moves a row', () => {
    const [a, b, c] = [row('quick_reply'), row('url'), row('phone')];
    expect(moveRow([a, b, c], 0, 1).map((r) => r.kind)).toEqual(['url', 'quick_reply', 'phone']);
    expect(moveRow([a, b, c], 0, -1)).toEqual([a, b, c]);
  });
});

describe('button issues', () => {
  const codes = (rows: ReturnType<typeof row>[]) => buttonIssues(rows).map((i) => i.code);

  it('needs text, and at most 25 characters', () => {
    expect(codes([row('quick_reply')])).toContain('textRequired');
    expect(codes([row('quick_reply', { text: 'x'.repeat(26) })])).toContain('textTooLong');
    expect(codes([row('quick_reply', { text: 'x'.repeat(25) })])).toEqual([]);
  });

  it('checks URL, phone and code', () => {
    expect(codes([row('url', { text: 'a' })])).toContain('urlRequired');
    expect(codes([row('url', { text: 'a', url: 'ftp://x' })])).toContain('urlInvalid');
    expect(codes([row('url', { text: 'a', url: 'https://x.test/{{1}}' })])).toContain(
      'urlExampleRequired',
    );
    expect(codes([row('phone', { text: 'a' })])).toContain('phoneRequired');
    expect(codes([row('copy_code')])).toContain('codeRequired');
  });

  it('refuses a variable in a quick reply', () => {
    expect(codes([row('quick_reply', { text: 'Hi {{1}}' })])).toContain('quickReplyVariable');
  });

  it('wants quick replies together at the start or the end', () => {
    const q = (i: number) => row('quick_reply', { text: `q${i}` });
    const u = row('url', { text: 'u', url: 'https://x.test' });
    expect(codes([q(1), q(2), u])).toEqual([]);
    expect(codes([u, q(1), q(2)])).toEqual([]);
    expect(codes([q(1), u, q(2)])).toContain('quickReplyPosition');
    const p = row('phone', { text: 'p', phone: '+1555' });
    expect(codes([u, q(1), p])).toContain('quickReplyPosition');
  });
});

describe("WaDesk's three-button editor", () => {
  it('stops at three rows however Meta would allow more', () => {
    const rows = [row('quick_reply'), row('quick_reply'), row('quick_reply')];
    expect(EDITOR_BUTTON_MAX).toBe(3);
    expect(canAdd(rows, 'quick_reply')).toBe(true);
    expect(canAdd(rows, 'quick_reply', EDITOR_BUTTON_MAX)).toBe(false);
    expect(canAdd([row('quick_reply')], 'quick_reply', EDITOR_BUTTON_MAX)).toBe(true);
  });

  it('reads a saved set as a call to action, quick reply or mixed set', () => {
    expect(modeOf([])).toBe('cta');
    expect(modeOf([row('url'), row('phone')])).toBe('cta');
    expect(modeOf([row('quick_reply'), row('quick_reply')])).toBe('reply');
    expect(modeOf([row('quick_reply'), row('url')])).toBe('mix');
  });

  it('offers each mode only its kinds', () => {
    expect(MODE_KINDS.reply).toEqual(['quick_reply']);
    expect(MODE_KINDS.cta).not.toContain('quick_reply');
    expect(MODE_KINDS.mix).toContain('quick_reply');
  });
});
