import { describe, expect, it } from 'vitest';
import {
  availableAccounts,
  findAccount,
  handleOf,
  isLive,
  manageUrl,
  resolveProfile,
  returnUrl,
} from '../../../src/modules/channel-instagram/account-rules';
import { toAccounts } from '../../../src/infra/providers/channel-instagram/http-instagram-bridge.client';
import type { BridgeAccount } from '../../../src/infra/providers/channel-instagram/instagram-bridge.port';

const acct = (id: string, extra: Partial<BridgeAccount> = {}): BridgeAccount => ({
  id,
  username: `user${id}`,
  name: `Name ${id}`,
  avatar: '',
  connected: true,
  ...extra,
});

describe('the handle and the live state (TW-IG-001)', () => {
  it('the handle is the username, else the name, without a leading @', () => {
    expect(handleOf('@shop', 'Shop')).toBe('shop');
    expect(handleOf(null, '@Shop Name')).toBe('Shop Name');
    expect(handleOf('', null)).toBe('');
  });

  it('only a disconnected status is not live; a missing status counts as connected', () => {
    expect(isLive('connected')).toBe(true);
    expect(isLive(null)).toBe(true);
    expect(isLive('disconnected')).toBe(false);
  });

  it('Manage opens the engine only while it is connected', () => {
    expect(manageUrl('https://ig.example.com/', true)).toBe('https://ig.example.com/instagram');
    expect(manageUrl('https://ig.example.com', false)).toBeNull();
    expect(manageUrl('', true)).toBeNull();
  });

  it('a window without an opener comes back to the hub', () => {
    expect(returnUrl('https://app.example.com/')).toBe('https://app.example.com/instagram');
  });
});

describe('the picker (TW-IG-003)', () => {
  it('lists the engine accounts that are not linked yet and drops a row with no id', () => {
    const out = availableAccounts(
      [acct('1'), acct('2'), acct('3', { connected: null }), acct('')],
      new Set(['2']),
    );
    expect(out.map((a) => a.id)).toEqual(['1', '3']);
  });

  it('shows an account as connected only when the engine said so', () => {
    const out = availableAccounts(
      [acct('1', { connected: null }), acct('2', { connected: false })],
      new Set(),
    );
    expect(out.map((a) => a.connected)).toEqual([false, false]);
  });
});

describe('the profile a mirror is saved with (TW-IG-004)', () => {
  it('what the picker knew wins, the engine fills the rest, the name falls back to the username', () => {
    expect(resolveProfile({ username: 'given' }, acct('1', { name: '' }))).toEqual({
      username: 'given',
      name: 'user1',
      avatar: '',
      status: 'connected',
    });
    expect(
      resolveProfile({ name: 'Given Name', avatar: 'https://a/x.png' }, acct('1')),
    ).toMatchObject({ username: 'user1', name: 'Given Name', avatar: 'https://a/x.png' });
  });

  it('the status follows the engine, and reads connected when the engine did not say', () => {
    expect(resolveProfile({}, acct('1', { connected: false })).status).toBe('disconnected');
    expect(resolveProfile({}, acct('1', { connected: null })).status).toBe('connected');
  });

  it('finds an account in the first list that has it', () => {
    const a = acct('9', { name: 'First' });
    const b = acct('9', { name: 'Second' });
    expect(findAccount([[acct('1')], [a], [b]], '9')).toBe(a);
    expect(findAccount([[acct('1')]], '9')).toBeUndefined();
  });
});

describe("reading the engine's account list", () => {
  it('keeps text and numbers as ids, drops rows without one, and leaves a missing connected flag unknown', () => {
    expect(
      toAccounts([
        { id: 17, username: 'a', name: 'A', avatar: 'u', connected: true },
        { id: ' ', username: 'blank' },
        { id: 'b' },
        'junk',
      ]),
    ).toEqual([
      { id: '17', username: 'a', name: 'A', avatar: 'u', connected: true },
      { id: 'b', username: '', name: '', avatar: '', connected: null },
    ]);
  });

  it('anything that is not a list is an empty list', () => {
    expect(toAccounts(null)).toEqual([]);
    expect(toAccounts({ accounts: [] })).toEqual([]);
  });
});
