import { describe, expect, it } from 'vitest';
import {
  deviceCopy,
  deviceNoticeFor,
  isFailureOutcome,
  maskedNumber,
  mayHearTeamChat,
  outcomeCopy,
  outcomeRecipients,
  sendKindOf,
  sendOutcomeFor,
  sendOutcomeKey,
  teamDirectCopy,
  teamDirectKey,
  teamMentionCollapseKey,
  teamMentionCopy,
  teamMentionKey,
  teamPreview,
} from '../../../src/modules/notifications/phase2-notification-rules';

describe('device notices (catalogue row 8)', () => {
  it('maps the transition events to a notification', () => {
    expect(deviceNoticeFor('device.connected', { state: 'connected' })).toBe('device_connected');
    expect(deviceNoticeFor('device.disconnected', { reason: 'proxy_unreachable' })).toBe(
      'device_disconnected',
    );
    expect(deviceNoticeFor('device.logged_out', { reason: 'unlinked_on_phone' })).toBe(
      'device_logged_out',
    );
  });

  it('says nothing about a disconnect or logout the person asked for', () => {
    expect(deviceNoticeFor('device.disconnected', { reason: 'user' })).toBeNull();
    expect(deviceNoticeFor('device.logged_out', { reason: 'user' })).toBeNull();
  });

  it('reads device.status_changed only for the silent-worker sweep, which has no transition event', () => {
    expect(
      deviceNoticeFor('device.status_changed', { state: 'disconnected', reason: 'worker_silent' }),
    ).toBe('device_disconnected');
    // Every status report fires this event: pairing steps and reconnects must not become rows.
    expect(
      deviceNoticeFor('device.status_changed', { state: 'connected', reason: null }),
    ).toBeNull();
    expect(
      deviceNoticeFor('device.status_changed', { state: 'awaiting_qr', reason: null }),
    ).toBeNull();
    expect(
      deviceNoticeFor('device.status_changed', { state: 'disconnected', reason: 'user' }),
    ).toBeNull();
    expect(deviceNoticeFor('device.created', {})).toBeNull();
  });

  it('shows the last four digits and nothing more', () => {
    expect(maskedNumber('919812345678')).toBe('…5678');
    expect(maskedNumber('+91 98123-45678')).toBe('…5678');
    expect(maskedNumber('123')).toBeNull();
    expect(maskedNumber(null)).toBeNull();
  });

  it('words the three cases without a QR, a code or a full number', () => {
    const down = deviceCopy('device_disconnected', 'Sales phone', '…5678', 'worker_silent');
    expect(down.title).toBe('Sales phone disconnected');
    expect(down.body).toContain('…5678');
    expect(down.body).toContain('stopped responding');
    expect(deviceCopy('device_logged_out', 'Sales phone', null, null).body).toContain(
      'Scan the QR',
    );
    expect(deviceCopy('device_connected', null, null, null).title).toBe(
      'WhatsApp number is back online',
    );
    for (const c of [down, deviceCopy('device_logged_out', 'x', '…1', null)]) {
      expect(`${c.title} ${c.body}`).not.toMatch(/\d{5,}/);
    }
  });
});

describe('send outcomes (catalogue row 9)', () => {
  it('knows the three events', () => {
    expect(sendKindOf('broadcast.status_changed')).toBe('broadcast');
    expect(sendKindOf('campaign.status_updated')).toBe('campaign');
    expect(sendKindOf('scheduled.status_changed')).toBe('scheduled_message');
    expect(sendKindOf('broadcast.created')).toBeNull();
  });

  it('turns only terminal statuses into a notification', () => {
    expect(sendOutcomeFor('broadcast', 'completed')).toBe('broadcast_completed');
    expect(sendOutcomeFor('broadcast', 'completed_with_errors')).toBe('broadcast_completed');
    expect(sendOutcomeFor('broadcast', 'failed')).toBe('broadcast_failed');
    expect(sendOutcomeFor('campaign', 'completed')).toBe('campaign_completed');
    expect(sendOutcomeFor('campaign', 'failed')).toBe('campaign_failed');
    expect(sendOutcomeFor('scheduled_message', 'completed')).toBe('scheduled_completed');
    expect(sendOutcomeFor('scheduled_message', 'failed')).toBe('scheduled_failed');
    for (const status of ['running', 'paused', 'scheduled', 'cancelled', 'draft', 'sending']) {
      for (const kind of ['broadcast', 'campaign', 'scheduled_message'] as const) {
        expect(sendOutcomeFor(kind, status), `${kind} ${status}`).toBeNull();
      }
    }
    expect(sendOutcomeFor('campaign', 'completed_with_errors')).toBeNull();
  });

  it('tells the starter of a success, and the starter plus the admins of a failure, each person once', () => {
    expect(outcomeRecipients('broadcast_completed', 7, [1, 2])).toEqual([7]);
    expect(outcomeRecipients('campaign_failed', 7, [1, 2])).toEqual([7, 1, 2]);
    // The starter is also an admin: one row.
    expect(outcomeRecipients('scheduled_failed', 1, [1, 2])).toEqual([1, 2]);
    // The starter left the workspace: a failure still reaches the admins, a success reaches nobody.
    expect(outcomeRecipients('broadcast_failed', null, [1])).toEqual([1]);
    expect(outcomeRecipients('broadcast_completed', null, [1])).toEqual([]);
    expect(isFailureOutcome('campaign_failed')).toBe(true);
    expect(isFailureOutcome('campaign_completed')).toBe(false);
  });

  it('words a finish with its counts and a failure with its reason', () => {
    expect(
      outcomeCopy('broadcast', 'broadcast_completed', 'Diwali offer', { sent: 98, failed: 2 }),
    ).toEqual({
      title: 'Broadcast finished',
      body: 'Broadcast "Diwali offer" finished. 98 sent, 2 failed.',
    });
    expect(
      outcomeCopy('campaign', 'campaign_completed', 'Spring', { sent: 10, failed: 0 }).body,
    ).toBe('Campaign "Spring" finished. 10 sent.');
    expect(
      outcomeCopy('scheduled_message', 'scheduled_failed', 'Reminder', {
        reason: 'Every recipient failed',
      }),
    ).toEqual({
      title: 'Scheduled message failed',
      body: 'Scheduled message "Reminder" failed. Every recipient failed',
    });
    expect(outcomeCopy('broadcast', 'broadcast_failed', null, {}).body).toBe('Broadcast failed.');
  });

  it('keys a row by kind, record, status and event, so a retry that finishes again notifies again but a redelivery does not', () => {
    const a = sendOutcomeKey('broadcast', 'u1', 'completed', '41');
    expect(a).toBe('broadcast:u1:completed:41');
    expect(sendOutcomeKey('broadcast', 'u1', 'completed', '41')).toBe(a);
    expect(sendOutcomeKey('broadcast', 'u1', 'completed', '97')).not.toBe(a);
  });
});

describe('team chat (catalogue row 10)', () => {
  const base = {
    channelType: 'public' as const,
    isMember: false,
    isAuthor: false,
    lastReadMessageId: 0,
    messageId: 50,
  };

  it('tells a person who has not read the message', () => {
    expect(mayHearTeamChat(base)).toBe(true);
    expect(mayHearTeamChat({ ...base, lastReadMessageId: 49 })).toBe(true);
  });

  it('is silent for the person looking at the channel (read pointer at or past the message)', () => {
    expect(mayHearTeamChat({ ...base, lastReadMessageId: 50 })).toBe(false);
    expect(mayHearTeamChat({ ...base, lastReadMessageId: 80 })).toBe(false);
  });

  it('never tells the author', () => {
    expect(mayHearTeamChat({ ...base, isAuthor: true })).toBe(false);
  });

  it('needs a membership row for a private or direct channel, but not for a public one', () => {
    expect(mayHearTeamChat({ ...base, channelType: 'private' })).toBe(false);
    expect(mayHearTeamChat({ ...base, channelType: 'dm' })).toBe(false);
    expect(mayHearTeamChat({ ...base, channelType: 'private', isMember: true })).toBe(true);
    expect(mayHearTeamChat({ ...base, channelType: 'dm', isMember: true })).toBe(true);
  });

  it('words a mention and a direct message, and a burst as a count', () => {
    const chan = { channelType: 'public' as const, channelName: 'sales', authorName: 'Asha' };
    expect(teamMentionCopy(chan, 'can you check?', 1)).toEqual({
      title: 'Asha mentioned you in #sales',
      body: 'can you check?',
    });
    expect(teamMentionCopy(chan, 'again', 3).title).toBe('3 new mentions in #sales');
    expect(teamMentionCopy({ ...chan, channelType: 'dm' }, '', 1).title).toBe(
      'Asha mentioned you in a direct message',
    );
    const dm = { channelType: 'dm' as const, channelName: null, authorName: 'Ravi' };
    expect(teamDirectCopy(dm, 'lunch?', 1).title).toBe('Ravi sent you a message');
    expect(teamDirectCopy(dm, 'lunch?', 4).title).toBe('4 new messages from Ravi');
  });

  it('collapses per channel and ends every row key with the outbox event id', () => {
    expect(teamMentionCollapseKey('c1')).toBe('tcmention:c1');
    expect(teamMentionKey('m1', 'u1', '77').split(':').pop()).toBe('77');
    expect(teamDirectKey('m1', 'u1', '78').split(':').pop()).toBe('78');
  });

  it('cuts the preview to plain text of at most 80 characters', () => {
    expect(teamPreview('  hello\n\n  world  ')).toBe('hello world');
    expect(teamPreview('x'.repeat(200))).toHaveLength(80);
    expect(teamPreview(null)).toBe('');
  });
});
