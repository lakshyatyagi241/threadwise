import { describe, expect, it } from 'vitest';
import { parseTurn } from '../inbox/parse';

// shapes from the real Waboo workspace support+demo: a live-chat hand-over is a turn flagged live_chat_connected with {type: 'info'} elements
const handover = (value: string, isUser: boolean) => ({
  ctype: 'livechat',
  bot_response: { input: true, input_type: 'LIVECHAT', live_chat_connected: true, response: [{ type: 'info', value, isUser }] },
});

describe('parseTurn: live-chat hand-over events', () => {
  it('"Connected to Aashish" is a system notice, not an agent message', () => {
    const t = parseTurn(handover('Connected to Aashish', true));
    expect(t).toMatchObject({ direction: 'out', senderKind: 'system', kind: 'system', body: 'Connected to Aashish' });
  });
  it('"You are now Connected to WABO DEMO" (the customer-side line) is kept, as a system notice too', () => {
    const t = parseTurn(handover('You are now Connected to WABO DEMO', false));
    expect(t).toMatchObject({ senderKind: 'system', kind: 'system', body: 'You are now Connected to WABO DEMO' });
  });
  it('an agent typing in a live chat stays an agent message', () => {
    const t = parseTurn({ ctype: 'livechat', bot_response: { input: true, input_type: 'LIVECHAT', response: [{ type: 'text', value: 'hi' }] } });
    expect(t).toMatchObject({ direction: 'out', senderKind: 'agent', kind: 'text', body: 'hi' });
  });
});
