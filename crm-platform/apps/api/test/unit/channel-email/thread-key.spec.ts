import { describe, expect, it } from 'vitest';
import { resolveThreadKey, THREAD_KEY_MAX } from '../../../src/infra/providers/channel-email';

const ROOT = '<root-1@mail.example.com>';

describe('resolveThreadKey: the provider names the thread', () => {
  it("Gmail's threadId is used verbatim, so the conversations that already exist keep their key", () => {
    expect(resolveThreadKey({ providerThreadId: '18c3f0a1b2c3d4e5', messageId: 'x@y' })).toBe(
      '18c3f0a1b2c3d4e5',
    );
  });

  it('a provider id that does not fit is hashed, stable, and fits', () => {
    const long = 'T'.repeat(300);
    const key = resolveThreadKey({ providerThreadId: long, messageId: 'x@y' });
    expect(key.length).toBeLessThanOrEqual(THREAD_KEY_MAX);
    expect(key).toBe(resolveThreadKey({ providerThreadId: long, messageId: 'z@y' }));
    expect(key).not.toBe(resolveThreadKey({ providerThreadId: `${long}x`, messageId: 'x@y' }));
  });

  it('a Graph conversationId is prefixed (or hashed when long) and wins over headers', () => {
    expect(
      resolveThreadKey({ conversationId: 'AAQkAD', messageId: 'a@b', references: [ROOT] }),
    ).toBe('c:AAQkAD');
    const key = resolveThreadKey({ conversationId: 'C'.repeat(400), messageId: 'a@b' });
    expect(key.startsWith('c:')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(THREAD_KEY_MAX);
  });

  it('the provider thread wins over a conversation id', () => {
    expect(
      resolveThreadKey({ providerThreadId: 'T1', conversationId: 'C1', messageId: 'a@b' }),
    ).toBe('T1');
  });
});

describe('resolveThreadKey: headers alone', () => {
  const rootKey = resolveThreadKey({ messageId: ROOT });

  it('a mail with no headers is its own root; the key is m:<hash>, stable and case/bracket-insensitive', () => {
    expect(rootKey).toMatch(/^m:[0-9a-f]{40}$/);
    expect(resolveThreadKey({ messageId: 'ROOT-1@mail.example.com' })).toBe(rootKey);
    expect(rootKey.length).toBeLessThanOrEqual(THREAD_KEY_MAX);
  });

  it('a reply and every later reply land on the root conversation through References[0]', () => {
    const reply = resolveThreadKey({
      messageId: '<r1@x>',
      inReplyTo: ROOT,
      references: [ROOT],
    });
    const later = resolveThreadKey({
      messageId: '<r2@x>',
      inReplyTo: '<r1@x>',
      references: [ROOT, '<r1@x>'],
    });
    expect(reply).toBe(rootKey);
    expect(later).toBe(rootKey);
  });

  it('a reply with In-Reply-To only takes the parent as the root', () => {
    expect(resolveThreadKey({ messageId: '<r1@x>', inReplyTo: ROOT })).toBe(rootKey);
  });

  it("a reply that names a mail we already hold joins that mail's thread, whatever the headers say", () => {
    const known = new Map([['<mid-5@x>', 'm:aaaa']]);
    expect(resolveThreadKey({ messageId: '<r@x>', inReplyTo: '<MID-5@x>' }, known)).toBe('m:aaaa');
    // the newest known ancestor decides
    const two = new Map([
      ['root@x', 'm:old'],
      ['mid@x', 'm:new'],
    ]);
    expect(
      resolveThreadKey({ messageId: 'r@x', references: ['root@x', 'mid@x', 'unknown@x'] }, two),
    ).toBe('m:new');
  });

  it('nothing known: the header root is used', () => {
    expect(resolveThreadKey({ messageId: '<r@x>', references: [ROOT, '<a@x>'] }, new Map())).toBe(
      rootKey,
    );
  });

  it('subjects never merge conversations: two unrelated mails stay two threads', () => {
    expect(resolveThreadKey({ messageId: '<one@x>' })).not.toBe(
      resolveThreadKey({ messageId: '<two@x>' }),
    );
  });

  it('blank references and a blank In-Reply-To are ignored', () => {
    expect(resolveThreadKey({ messageId: ROOT, inReplyTo: '  ', references: ['', '<>'] })).toBe(
      rootKey,
    );
  });
});
