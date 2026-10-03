import { describe, expect, it } from 'vitest';
import {
  CONNECTED_EVENT,
  connectedAccount,
  engineOrigin,
  handleOf,
  initialsOf,
  isConnected,
  planConnect,
} from './accounts-model';

const acct = (id: string) => ({
  id,
  username: `u${id}`,
  name: `N${id}`,
  avatar: '',
  connected: true,
});

describe('what a row shows (TW-IG-001)', () => {
  it('the handle is the username, else the name, with one @', () => {
    expect(handleOf('shop', 'Shop')).toBe('@shop');
    expect(handleOf('@@shop', null)).toBe('@shop');
    expect(handleOf(null, '@Shop Name')).toBe('@Shop Name');
    expect(handleOf('', '')).toBe('@');
  });

  it('the chip is two upper-case letters of the name, else the username', () => {
    expect(initialsOf('asha kumar', 'x')).toBe('AS');
    expect(initialsOf('', '@shop')).toBe('SH');
    expect(initialsOf(null, null)).toBe('');
  });

  it('only a connected status is connected', () => {
    expect(isConnected('connected')).toBe(true);
    expect(isConnected('disconnected')).toBe(false);
  });
});

describe('what Connect Instagram does (TW-IG-002)', () => {
  it('links the one account at once, offers several in a picker, and opens the popup for none or a failed lookup', () => {
    expect(planConnect([acct('1')])).toEqual({ kind: 'link', account: acct('1') });
    expect(planConnect([acct('1'), acct('2')])).toEqual({
      kind: 'pick',
      accounts: [acct('1'), acct('2')],
    });
    expect(planConnect([])).toEqual({ kind: 'popup' });
    expect(planConnect(null)).toEqual({ kind: 'popup' });
  });
});

describe('the engine’s window message', () => {
  const origin = engineOrigin('https://engine.example.com/instagram');

  it('reads the origin from the Manage address', () => {
    expect(origin).toBe('https://engine.example.com');
    expect(engineOrigin(null)).toBeNull();
    expect(engineOrigin('not a url')).toBeNull();
  });

  it('gives the account id for the connected message from the engine, number or text', () => {
    expect(
      connectedAccount(
        { origin: origin!, data: { type: CONNECTED_EVENT, account_id: 'A1' } },
        origin,
      ),
    ).toBe('A1');
    expect(
      connectedAccount(
        { origin: origin!, data: { type: CONNECTED_EVENT, account_id: 42 } },
        origin,
      ),
    ).toBe('42');
  });

  it('ignores another origin, another message, a missing id, or any message while the engine address is unknown', () => {
    const ok = { type: CONNECTED_EVENT, account_id: 'A1' };
    expect(connectedAccount({ origin: 'https://evil.test', data: ok }, origin)).toBeNull();
    expect(
      connectedAccount({ origin: origin!, data: { type: 'other', account_id: 'A1' } }, origin),
    ).toBeNull();
    expect(
      connectedAccount({ origin: origin!, data: { type: CONNECTED_EVENT } }, origin),
    ).toBeNull();
    expect(
      connectedAccount(
        { origin: origin!, data: { type: CONNECTED_EVENT, account_id: '' } },
        origin,
      ),
    ).toBeNull();
    expect(connectedAccount({ origin: origin!, data: 'text' }, origin)).toBeNull();
    expect(connectedAccount({ origin: origin!, data: null }, origin)).toBeNull();
    expect(connectedAccount({ origin: origin!, data: ok }, null)).toBeNull();
  });
});
