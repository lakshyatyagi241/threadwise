import { describe, expect, it } from 'vitest';
import { waitingConfig } from '../../../src/config/domains/notifications.env';

/** The settings of the "waiting for a reply" nudge (BL-098): the documented default is 5 minutes. */
describe('waitingConfig', () => {
  it('defaults to five minutes, on, a 24 hour lookback and 100 chats per sweep', () => {
    expect(waitingConfig({ NODE_ENV: 'development' })).toEqual({
      enabled: true,
      minutes: 5,
      lookbackHours: 24,
      batch: 100,
    });
  });

  it('reads NOTIFY_WAITING_MINUTES', () => {
    expect(waitingConfig({ NODE_ENV: 'development', NOTIFY_WAITING_MINUTES: '15' }).minutes).toBe(
      15,
    );
  });

  it('rejects a wait of zero or a nonsense value instead of nudging every chat at once', () => {
    expect(() => waitingConfig({ NOTIFY_WAITING_MINUTES: '0' })).toThrow();
    expect(() => waitingConfig({ NOTIFY_WAITING_MINUTES: 'soon' })).toThrow();
  });

  it('has its own off switch', () => {
    expect(
      waitingConfig({ NODE_ENV: 'development', NOTIFY_WAITING_ENABLED: 'false' }).enabled,
    ).toBe(false);
  });

  it('follows the conversation notifications switch: off there means off here', () => {
    expect(
      waitingConfig({ NODE_ENV: 'development', NOTIFY_CONVERSATIONS_ENABLED: 'false' }).enabled,
    ).toBe(false);
    // In production the family is off until the operator sets it, and so is the nudge.
    expect(waitingConfig({ NODE_ENV: 'production' }).enabled).toBe(false);
    expect(
      waitingConfig({ NODE_ENV: 'production', NOTIFY_CONVERSATIONS_ENABLED: 'true' }).enabled,
    ).toBe(true);
  });
});
