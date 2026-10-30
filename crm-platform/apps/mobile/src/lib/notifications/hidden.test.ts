import { NOTIFICATION_PREF_TYPES, type NotificationResponse } from '@crm/contracts';
import { isHiddenType, visibleRows } from './hidden';

const HIDDEN = [
  'mention',
  'email_bounced',
  'member_leave_started',
  'assignment_blocked_by_leave',
  'appointment_calendar_drift',
  'appointment_cancelled_by_customer',
  'appointment_reminder_test',
  'new_lead',
  'form_submission',
  'form_needs_review',
  'form_payment',
  'form_payment_duplicate',
  'sales_doc_decided',
  'wallet_low_balance',
  'wallet_credited',
  'test',
  // whole sections
  'billing_payment_failed',
  'billing_subscription_canceled',
  'marketplace_renewal_due',
  'marketplace_payment_failed',
  'marketplace_subscription_ended',
  'device_connected',
  'device_disconnected',
  'device_logged_out',
  'broadcast_completed',
  'broadcast_failed',
  'campaign_completed',
  'campaign_failed',
  'scheduled_completed',
  'scheduled_failed',
  'teamchat_mention',
  'teamchat_message',
  'waba_group_join_request',
  'waba_group_suspended',
  'waba_group_suspension_cleared',
  'device_group_join_request',
  'device_group_removed',
];
const SHOWN = [
  'new_chat',
  'new_message',
  'chat_waiting',
  'conversation_assigned',
  'snooze_wake',
  'sla_breached',
  'task_assigned',
  'task_due',
  'task_completed',
];

describe('isHiddenType', () => {
  it.each(HIDDEN)('hides %s', (type) => {
    expect(isHiddenType(type)).toBe(true);
  });

  it.each(SHOWN)('shows %s', (type) => {
    expect(isHiddenType(type)).toBe(false);
  });

  it('names every kind the contracts know as hidden or shown, so a new one is decided on purpose', () => {
    const decided = new Set([...HIDDEN, ...SHOWN]);
    expect(NOTIFICATION_PREF_TYPES.filter((type) => !decided.has(type))).toEqual([]);
  });

  it('shows a kind this build does not know: it may be about a chat', () => {
    expect(isHiddenType('a_future_kind')).toBe(false);
  });
});

describe('visibleRows', () => {
  const row = (type: string) => ({ type }) as NotificationResponse;
  it('keeps the shown rows in their order and drops the hidden ones', () => {
    const rows = [row('new_lead'), row('new_message'), row('device_disconnected'), row('task_due')];
    expect(visibleRows(rows).map((r) => r.type)).toEqual(['new_message', 'task_due']);
  });
});
