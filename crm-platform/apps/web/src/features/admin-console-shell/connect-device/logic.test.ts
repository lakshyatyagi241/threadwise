import { describe, expect, it } from 'vitest';
import { CONNECT_EVENTS, parseConnectMessage } from './logic';

describe('connect-device sheet messages (WD-ASHELL-029)', () => {
  const frame = {};
  const ok = { origin: 'https://app.test', source: frame };
  it('accepts connected and close from the sheet frame only', () => {
    expect(
      parseConnectMessage(
        { ...ok, data: { type: CONNECT_EVENTS.connected } },
        'https://app.test',
        frame,
      ),
    ).toBe('connected');
    expect(
      parseConnectMessage(
        { ...ok, data: { type: CONNECT_EVENTS.close } },
        'https://app.test',
        frame,
      ),
    ).toBe('close');
  });
  it('ignores other origins, other windows and unknown types', () => {
    const data = { type: CONNECT_EVENTS.close };
    expect(
      parseConnectMessage(
        { origin: 'https://evil.test', source: frame, data },
        'https://app.test',
        frame,
      ),
    ).toBeNull();
    expect(parseConnectMessage({ ...ok, source: {}, data }, 'https://app.test', frame)).toBeNull();
    expect(
      parseConnectMessage({ ...ok, data: { type: 'x' } }, 'https://app.test', frame),
    ).toBeNull();
    expect(parseConnectMessage({ ...ok, data: null }, 'https://app.test', null)).toBeNull();
  });
});
