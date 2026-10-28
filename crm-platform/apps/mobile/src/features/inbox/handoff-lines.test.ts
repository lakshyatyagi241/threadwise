import { botLineKeys, giveBackKey, type BotReturnedEvent } from './handoff-lines';

describe('giveBackKey', () => {
  it('says the bot already had it on a second press', () => {
    expect(
      giveBackKey({ resumed: 'next_message', nextMessageBy: 'default_flow', alreadyWithBot: true }),
    ).toBe('already');
  });

  it('says the flow continues when it does', () => {
    expect(giveBackKey({ resumed: 'flow', nextMessageBy: null, alreadyWithBot: false })).toBe(
      'doneFlow',
    );
  });

  it('tells a waiting flow from the default flow for the next message', () => {
    expect(
      giveBackKey({ resumed: 'next_message', nextMessageBy: 'live_flow', alreadyWithBot: false }),
    ).toBe('doneNextLive');
    expect(
      giveBackKey({
        resumed: 'next_message',
        nextMessageBy: 'default_flow',
        alreadyWithBot: false,
      }),
    ).toBe('doneNextDefault');
  });
});

describe('botLineKeys', () => {
  const pressed = (over: Partial<BotReturnedEvent> = {}): BotReturnedEvent => ({
    event: 'bot_returned',
    stage: 'pressed',
    by: 'Asha',
    ...over,
  });

  it('writes one sentence for the moment the button was pressed', () => {
    expect(botLineKeys(pressed({ resumed: 'flow' }))).toEqual(['pressed.flow']);
    expect(botLineKeys(pressed({ resumed: 'next_message', nextMessageBy: 'live_flow' }))).toEqual([
      'pressed.nextLive',
    ]);
    expect(
      botLineKeys(pressed({ resumed: 'next_message', nextMessageBy: 'default_flow' })),
    ).toEqual(['pressed.nextDefault']);
    // Nothing said about the next message: the default flow is the careful wording.
    expect(botLineKeys(pressed({ resumed: 'next_message' }))).toEqual(['pressed.nextDefault']);
  });

  it('writes what happened to the flow and to the customer after it', () => {
    expect(
      botLineKeys({
        event: 'bot_returned',
        stage: 'result',
        result: 'continued',
        customer: 'sent',
      }),
    ).toEqual(['result.continued', 'customer.sent']);
    expect(
      botLineKeys({ event: 'bot_returned', stage: 'result', customer: 'window_closed' }),
    ).toEqual(['customer.window_closed']);
    expect(botLineKeys({ event: 'bot_returned', stage: 'result' })).toEqual([]);
  });
});
