import { describe, expect, it } from 'vitest';
import { html } from '../wizard/testing';
import { SenderEmptyNotice, SenderLoading } from './sender-empty';

describe('the empty "Send from" notice', () => {
  it('the SMS card words "nothing connected" for SMS and links to the SMS screen', () => {
    const out = html(<SenderEmptyNotice hidden={[]} sms />);
    expect(out).toContain('No SMS sender is connected');
    expect(out).toContain('href="/sms"');
    expect(out).not.toContain('WhatsApp');
  });

  it('the SMS card still explains a pending number', () => {
    const out = html(
      <SenderEmptyNotice hidden={[{ engine: 'sms', reason: 'pending', count: 1 }]} sms />,
    );
    expect(out).toContain('1 number is still connecting');
    expect(out).toContain('href="/sms"');
  });

  it('carries no phone number or label, only the cause and its count', () => {
    const out = html(
      <SenderEmptyNotice hidden={[{ engine: 'waba', reason: 'error', count: 3 }]} />,
    );
    expect(out).toContain('data-cause="error"');
    expect(out).toContain('The connection of 3 numbers failed');
  });

  it('the loading placeholder is a busy status, not an empty select', () => {
    const out = html(<SenderLoading id="x" />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('role="status"');
    expect(out).not.toContain('<select');
  });
});
