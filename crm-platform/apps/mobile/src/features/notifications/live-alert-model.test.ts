import {
  isInboxAlertType,
  isReadingChat,
  openConversationId,
  wantsAlert,
} from './live-alert-model';

const ID = '71111111-1111-4111-8111-111111111111';

describe('wantsAlert', () => {
  it('drops down for a chat message that is neither silent nor turned off', () => {
    expect(wantsAlert({ type: 'new_message', silent: false })).toBe(true);
    expect(wantsAlert({ type: 'new_chat', silent: false, toast: true })).toBe(true);
  });

  it('stays quiet for a silent event, whatever the person asked for', () => {
    expect(wantsAlert({ type: 'new_message', silent: true, toast: true })).toBe(false);
  });

  it("stays quiet when the person's own preference has the pop-up off", () => {
    expect(wantsAlert({ type: 'new_message', silent: false, toast: false })).toBe(false);
  });

  it('stays quiet for kinds that are not a chat in the inbox', () => {
    for (const type of ['task_assigned', 'device_disconnected', 'wallet_low_balance', 'whatever']) {
      expect(wantsAlert({ type, silent: false })).toBe(false);
      expect(isInboxAlertType(type)).toBe(false);
    }
  });
});

describe('the chat that is open', () => {
  it('is read from the conversation route, in lower case', () => {
    expect(openConversationId(`/conversation/${ID.toUpperCase()}`)).toBe(ID);
    expect(openConversationId(`/conversation/${ID}?x=1`)).toBe(ID);
  });

  it('is none on any other screen', () => {
    expect(openConversationId('/inbox')).toBeNull();
    expect(openConversationId('/menu')).toBeNull();
    expect(openConversationId(null)).toBeNull();
  });

  it('says the person is reading it only for that chat', () => {
    expect(isReadingChat(`/conversation/${ID}`, ID.toUpperCase())).toBe(true);
    expect(isReadingChat(`/conversation/${ID}`, '82222222-2222-4222-8222-222222222222')).toBe(
      false,
    );
    expect(isReadingChat('/inbox', ID)).toBe(false);
    expect(isReadingChat(`/conversation/${ID}`, null)).toBe(false);
  });
});
