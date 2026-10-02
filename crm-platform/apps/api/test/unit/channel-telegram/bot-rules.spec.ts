import { describe, expect, it } from 'vitest';
import { BOT_TOKEN_PATTERN } from '@crm/contracts';
import {
  clipError,
  randomToken,
  webhookRefusedMessage,
  webhookUrl,
} from '../../../src/modules/channel-telegram/bot-rules';

describe('bot rules (WD-TG-002)', () => {
  it('a routing token is 48 URL-safe characters and never repeats', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(randomToken()).not.toBe(a);
    expect(randomToken(10)).toHaveLength(10);
  });

  it('the webhook address is forced to https and tolerates a trailing slash', () => {
    expect(webhookUrl('http://localhost:3000', 'abc')).toBe(
      'https://localhost:3000/v2/telegram/inbound/abc',
    );
    expect(webhookUrl('https://api.example.com/', 'abc')).toBe(
      'https://api.example.com/v2/telegram/inbound/abc',
    );
    expect(webhookUrl('HTTP://X.test', 't')).toBe('https://X.test/v2/telegram/inbound/t');
  });

  it('an error is kept to 255 characters; nothing stays nothing', () => {
    expect(clipError('x'.repeat(300))).toHaveLength(255);
    expect(clipError('short')).toBe('short');
    expect(clipError(null)).toBeNull();
    expect(clipError('')).toBeNull();
  });

  it('the refusal text says the bot is saved and points at a public HTTPS address', () => {
    const m = webhookRefusedMessage('bad webhook: https required');
    expect(m).toContain('Saved the bot');
    expect(m).toContain('bad webhook: https required');
    expect(m).toContain('public HTTPS');
  });

  it('the BotFather token pattern takes the real shape and refuses the rest', () => {
    expect(BOT_TOKEN_PATTERN.test('123456789:AAH-abcdefghijklmnopqrstuvwxyz_0123')).toBe(true);
    for (const bad of [
      '',
      'abc',
      '12345:short',
      '123456789 AAHabcdefghijklmnopqrstuvwxyz0123456',
      'x123456789:AAHabcdefghijklmnopqrstuvwxyz0123456',
    ]) {
      expect(BOT_TOKEN_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
