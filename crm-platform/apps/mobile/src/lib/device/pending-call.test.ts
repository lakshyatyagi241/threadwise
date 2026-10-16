import { forgetCall, markAppLeft, rememberCall, takeReturnedCall } from './pending-call';

const party = { contactId: 'c1', name: 'Aarav', phone: '+919800000001' };

afterEach(() => forgetCall());

describe('pending call', () => {
  it('is offered once, after the app has been left and come back, with how long it was away', () => {
    rememberCall(party, 1_000);
    markAppLeft();
    expect(takeReturnedCall(91_400)).toEqual({ party, startedAt: 1_000, durationSec: 90 });
    expect(takeReturnedCall(95_000)).toBeNull();
  });

  it('is not offered when the app was never left (the call never started)', () => {
    rememberCall(party, 1_000);
    expect(takeReturnedCall(5_000)).toBeNull();
    // It is still waiting: leaving and returning later offers it.
    markAppLeft();
    expect(takeReturnedCall(9_000)?.party).toEqual(party);
  });

  it('is gone once forgotten (a watcher took the call over)', () => {
    rememberCall(party);
    forgetCall();
    markAppLeft();
    expect(takeReturnedCall()).toBeNull();
  });
});
