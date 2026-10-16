import { describe, expect, it } from 'vitest';
import {
  EMAIL_RECEIVED_ACTIVITY,
  EMAIL_SENT_ACTIVITY,
  NO_SUBJECT,
  TIMELINE_PREVIEW_MAX,
  TIMELINE_TITLE_MAX,
  inboundKey,
  isTimelineWorthy,
  outboundKey,
  previewOf,
  receivedEntry,
  sentEntry,
  writesToTimeline,
} from '../../../src/modules/channel-email/mail-timeline-rules';

describe('who writes to the contact timeline (E-19)', () => {
  it('only a shared mailbox does: a personal mailbox is private to its owner', () => {
    expect(writesToTimeline('shared')).toBe(true);
    expect(writesToTimeline('personal')).toBe(false);
  });
  it('automated mail (auto-reply, list, flood-limited) leaves no entry', () => {
    expect(isTimelineWorthy(false)).toBe(true);
    expect(isTimelineWorthy(true)).toBe(false);
  });
});

describe('dedupe keys', () => {
  it('are stable per mailbox, direction and message id', () => {
    expect(inboundKey('mb-1', 'gm-9')).toBe('mb-1:in:gm-9');
    expect(outboundKey('mb-1', 'abc@acme.test')).toBe('mb-1:out:abc@acme.test');
    expect(inboundKey('mb-1', 'x')).not.toBe(inboundKey('mb-2', 'x'));
    expect(inboundKey('mb-1', 'x')).not.toBe(outboundKey('mb-1', 'x'));
  });
  it('never exceed the column limit', () => {
    expect(inboundKey('mb', 'x'.repeat(2_000)).length).toBe(500);
    expect(outboundKey('mb', 'x'.repeat(2_000)).length).toBe(500);
  });
});

describe('previewOf', () => {
  it('collapses whitespace onto one line', () => {
    expect(previewOf('Hello\n\n  there,\r\nthanks')).toBe('Hello there, thanks');
  });
  it('drops quoted earlier mail and everything after the reply header', () => {
    expect(
      previewOf('Yes, Tuesday works.\n> What day?\nOn Mon, 5 Oct 2026, Ana wrote:\n> older'),
    ).toBe('Yes, Tuesday works.');
    expect(previewOf('Fine.\n-----Original Message-----\nFrom: x\nolder')).toBe('Fine.');
  });
  it('is null when nothing readable is left', () => {
    expect(previewOf(null)).toBeNull();
    expect(previewOf('')).toBeNull();
    expect(previewOf('(no text)')).toBeNull();
    expect(previewOf('> only a quote')).toBeNull();
  });
  it('is cut at the limit with an ellipsis', () => {
    const out = previewOf('word '.repeat(200))!;
    expect(out.length).toBeLessThanOrEqual(TIMELINE_PREVIEW_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('entries', () => {
  it('a received mail names the sender and the subject', () => {
    const e = receivedEntry({
      subject: '  Order   42 ',
      from: { name: 'Ana Customer', address: 'ana@example.com' },
      text: 'Where is it?',
    });
    expect(e).toEqual({
      activityType: EMAIL_RECEIVED_ACTIVITY,
      title: 'Email received from Ana Customer: Order 42',
      body: 'Where is it?',
    });
  });
  it('falls back to the address and to "(no subject)"', () => {
    const e = receivedEntry({
      subject: '',
      from: { name: null, address: 'ana@example.com' },
      text: null,
    });
    expect(e.title).toBe(`Email received from ana@example.com: ${NO_SUBJECT}`);
    expect(e.body).toBeNull();
  });
  it('a sent mail names the first recipient and counts the others', () => {
    const e = sentEntry({
      subject: 'Re: Order 42',
      to: ['ana@example.com', 'bob@example.com', 'cy@example.com'],
      text: 'On its way.',
    });
    expect(e).toEqual({
      activityType: EMAIL_SENT_ACTIVITY,
      title: 'Email sent to ana@example.com (+2): Re: Order 42',
      body: 'On its way.',
    });
  });
  it('a hostile subject cannot blow the title past its limit', () => {
    const e = sentEntry({ subject: 's'.repeat(5_000), to: ['a@b.test'], text: '' });
    expect(e.title.length).toBeLessThanOrEqual(TIMELINE_TITLE_MAX);
  });
});
