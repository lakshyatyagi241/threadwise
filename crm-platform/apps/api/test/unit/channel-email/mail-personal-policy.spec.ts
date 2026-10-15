import { describe, expect, it } from 'vitest';
import {
  mayAct,
  personalConnectRefusal,
  viewOf,
  type MailActor,
} from '../../../src/modules/channel-email/mail-personal-policy';

const ME = 7;
const OTHER = 8;
const actor = (over: Partial<MailActor> = {}): MailActor => ({
  userId: ME,
  canManageShared: false,
  canManagePersonal: true,
  isAdmin: false,
  ...over,
});
const admin = actor({ canManageShared: true, isAdmin: true });
const shared = { scope: 'shared', ownerUserId: null } as const;
const mine = { scope: 'personal', ownerUserId: ME } as const;
const theirs = { scope: 'personal', ownerUserId: OTHER } as const;
const off = { adminsCanReadPersonal: false };
const on = { adminsCanReadPersonal: true };

describe('TW-MAIL-035 who may connect a personal mailbox', () => {
  it('is refused while the workspace has not enabled personal mailboxes, whoever asks', () => {
    const policy = { personalMailboxesEnabled: false, whoMayConnectPersonal: 'agents' } as const;
    expect(personalConnectRefusal(actor(), policy)).toBe('disabled');
    expect(personalConnectRefusal(admin, policy)).toBe('disabled');
  });
  it('"admins" lets only admins connect, "agents" anyone holding manage_personal', () => {
    const admins = { personalMailboxesEnabled: true, whoMayConnectPersonal: 'admins' } as const;
    const agents = { personalMailboxesEnabled: true, whoMayConnectPersonal: 'agents' } as const;
    expect(personalConnectRefusal(actor(), admins)).toBe('not_allowed');
    expect(personalConnectRefusal(admin, admins)).toBeNull();
    expect(personalConnectRefusal(actor(), agents)).toBeNull();
    expect(personalConnectRefusal(actor({ canManagePersonal: false }), agents)).toBe('not_allowed');
  });
});

describe('TW-MAIL-035 what the hub shows of a mailbox', () => {
  it('shows shared mailboxes in full to everyone and your own personal one in full', () => {
    expect(viewOf(actor(), shared, off)).toBe('full');
    expect(viewOf(actor(), mine, off)).toBe('full');
  });
  it("hides another person's personal mailbox from an agent entirely, whatever the policy", () => {
    expect(viewOf(actor(), theirs, off)).toBe('none');
    expect(viewOf(actor(), theirs, on)).toBe('none');
  });
  it('shows an admin a summary, or the full row only when the policy lets admins read it', () => {
    expect(viewOf(admin, theirs, off)).toBe('summary');
    expect(viewOf(admin, theirs, on)).toBe('full');
  });
});

describe('TW-MAIL-035 what a person may do to a mailbox', () => {
  it('a shared mailbox needs mail.mailboxes.manage', () => {
    expect(mayAct(actor(), shared, 'rename')).toBe(false);
    expect(mayAct(admin, shared, 'sync')).toBe(true);
  });
  it('the owner manages their own personal mailbox, only while they still hold manage_personal', () => {
    for (const a of ['rename', 'sync', 'reconnect', 'disconnect'] as const) {
      expect(mayAct(actor(), mine, a)).toBe(true);
      expect(mayAct(actor({ canManagePersonal: false }), mine, a)).toBe(false);
    }
  });
  it("an admin may disconnect somebody's personal mailbox and do nothing else to it; an agent nothing", () => {
    expect(mayAct(admin, theirs, 'disconnect')).toBe(true);
    for (const a of ['rename', 'sync', 'reconnect'] as const) {
      expect(mayAct(admin, theirs, a)).toBe(false);
    }
    expect(mayAct(actor(), theirs, 'disconnect')).toBe(false);
  });
});
