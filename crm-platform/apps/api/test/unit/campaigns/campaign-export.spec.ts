import { describe, expect, it } from 'vitest';
import { EXPORT_HEADER, lastEventOf } from '../../../src/modules/campaigns/campaigns-actions.service';

const none = {
  status: 'queued',
  respondedAt: null,
  clickedAt: null,
  readAt: null,
  deliveredAt: null,
  sentAt: null,
};
const at = new Date('2026-10-10T10:20:00Z');

describe('campaign export columns', () => {
  it('names the A/B column Version, the same as the Messages table', () => {
    expect(EXPORT_HEADER).toContain('Version');
    expect(EXPORT_HEADER).not.toContain('Variant');
  });
});

describe('lastEventOf', () => {
  it('a failed recipient that never got a sent time is Failed, not Queued', () => {
    expect(lastEventOf({ ...none, status: 'failed' })).toBe('Failed');
  });

  it('a skipped or opted-out recipient names that status, not Queued', () => {
    expect(lastEventOf({ ...none, status: 'skipped' })).toBe('Skipped');
    expect(lastEventOf({ ...none, status: 'unsubscribed' })).toBe('Unsubscribed');
  });

  it('a recipient still waiting to go out is Queued', () => {
    expect(lastEventOf(none)).toBe('Queued');
    expect(lastEventOf({ ...none, status: 'pending' })).toBe('Queued');
  });

  it('reports the newest event that happened, in order', () => {
    expect(lastEventOf({ ...none, status: 'responded', sentAt: at, readAt: at, respondedAt: at })).toBe(
      'Reply',
    );
    expect(lastEventOf({ ...none, status: 'read', sentAt: at, readAt: at, clickedAt: at })).toBe(
      'Button tap',
    );
    expect(lastEventOf({ ...none, status: 'read', sentAt: at, readAt: at })).toBe('Read');
    expect(lastEventOf({ ...none, status: 'delivered', sentAt: at, deliveredAt: at })).toBe(
      'Delivered',
    );
    expect(lastEventOf({ ...none, status: 'sent', sentAt: at })).toBe('Sent');
  });
});
