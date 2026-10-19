import { i18n, initI18n } from '@/lib/i18n';
import {
  deviceDown,
  futureType,
  newLead,
  newMessage,
  taskAssigned,
} from '@/test/notifications-fixtures';
import { clipPreview, notificationText, translatorFor } from './notification-text';

beforeAll(async () => {
  await initI18n('en');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

const t = translatorFor(i18n);

describe('what a notification says', () => {
  it('words a collapsed chat from the contact, the count and the preview', () => {
    expect(notificationText(t, newMessage)).toEqual({
      title: '3 new messages from Aarav Sharma',
      body: 'Is the demo on Friday?',
    });
  });

  it('words a snoozed chat coming back, for the person or for the team', () => {
    const row = { type: 'snooze_wake', title: 'x', body: null, count: 1 };
    expect(notificationText(t, { ...row, data: { contactName: 'Aarav Sharma' } })).toEqual({
      title: 'Aarav Sharma is back in your list',
      body: null,
    });
    expect(
      notificationText(t, { ...row, data: { contactName: 'Aarav Sharma', teamAssigned: true } })
        .title,
    ).toBe('Aarav Sharma is back for your team');
    expect(notificationText(t, { ...row, data: {} }).title).toBe(
      'A snoozed chat is back in your list',
    );
  });

  it('uses the no-name wording when the contact has no name', () => {
    const row = { ...newMessage, data: { conversationId: 'x', preview: 'Hello' }, count: 1 };
    expect(notificationText(t, row).title).toBe('1 new message');
  });

  it('words a task from its title and who assigned it', () => {
    expect(notificationText(t, taskAssigned)).toEqual({
      title: 'Task assigned to you',
      body: 'Meera Nair assigned you: Send the contract',
    });
    expect(
      notificationText(t, { ...taskAssigned, data: { taskTitle: 'Send the contract' } }).body,
    ).toBe('Send the contract');
  });

  it('words a lead with its platform', () => {
    expect(notificationText(t, newLead)).toEqual({
      title: 'New lead',
      body: 'Riya Kapoor came in from Facebook',
    });
  });

  it('words a device, and a send outcome with how many went out and failed', () => {
    expect(notificationText(t, deviceDown)).toEqual({
      title: 'Sales line disconnected',
      body: 'Open the device to reconnect.',
    });
    const done = {
      type: 'broadcast_completed',
      title: 'x',
      body: null,
      data: { name: 'Diwali offer', sent: 120, failed: 3 },
    };
    expect(notificationText(t, done)).toEqual({
      title: 'Broadcast “Diwali offer” finished',
      body: '120 messages sent, 3 failed',
    });
    expect(notificationText(t, { ...done, data: { name: 'Diwali offer', sent: 1 } }).body).toBe(
      '1 message sent',
    );
  });

  it('shows the reason of a failed send as it came', () => {
    const failed = {
      type: 'campaign_failed',
      title: 'x',
      body: null,
      data: { name: 'Autumn', reason: 'Template rejected' },
    };
    expect(notificationText(t, failed).body).toBe('Template rejected');
    expect(notificationText(t, { ...failed, data: { name: 'Autumn' } }).body).toBe(
      'Open it to see what went wrong.',
    );
  });

  it("falls back to the server's English for a type this build has no words for", () => {
    expect(notificationText(t, futureType)).toEqual({
      title: 'Quote expired',
      body: 'The quote for Acme expired today.',
    });
  });

  it('follows the app language, with the right plural form', async () => {
    await i18n.changeLanguage('ru');
    const two = { ...newMessage, count: 2, data: { ...newMessage.data, count: 2 } };
    expect(notificationText(t, two).title).not.toBe(
      notificationText(translatorFor(i18n), newMessage).title,
    );
    expect(notificationText(t, two).title).toContain('Aarav Sharma');
  });
});

describe('previews', () => {
  it('cuts on one line without splitting an emoji', () => {
    expect(clipPreview('  a\n\n b  ')).toBe('a b');
    const cut = clipPreview('😀'.repeat(100), 10);
    expect(Array.from(cut)).toHaveLength(10);
    expect(cut.endsWith('…')).toBe(true);
  });
});
