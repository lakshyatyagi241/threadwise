import { describe, expect, it } from 'vitest';
import {
  CONSENT_GATE_REASONS,
  consentChannelOfKind,
  type ConsentGateResult,
  type ConsentSubject,
  type MinorRule,
  type PurposeInput,
} from '@crm/contracts';
import {
  NO_FACTS,
  decideConsent,
  type ConsentFacts,
} from '../../../src/modules/contact-consent/consent-gate.rules';
import {
  consentSkipNote,
  consentSkipReason,
  countSkipReasons,
  gateRecipients,
} from '../../../src/modules/contact-consent/consent-gate.recipients';
import {
  ConsentGate,
  type GateManyResult,
} from '../../../src/modules/contact-consent/consent-gate.service';
import type { ConsentPolicyService } from '../../../src/modules/contact-consent/consent-policy.service';
import type { DatabaseService } from '../../../src/infra/db/database.service';

/**
 * BL-141 follow-up: every marketing-purpose first send of the six broadcast channels goes through the ConsentGate. The truth table below
 * is the gate's own rule (`decideConsent`) read per channel of those senders; `gateRecipients` is what the senders share to put a slice
 * of recipients through it; the guard test (consent-gate-guard.spec.ts) proves each sender calls it for every recipient.
 */

/** The consent channel each broadcast sender asks about, by the channel kind its audience lives on. */
const CHANNELS = ['telegram', 'facebook', 'instagram', 'viber', 'line', 'wechat'] as const;

const facts = (f: Partial<ConsentFacts> = {}): ConsentFacts => ({ ...NO_FACTS, ...f });

interface Opts {
  requireConsent?: boolean;
  minorRule?: MinorRule;
  replyWindowOpen?: boolean;
  f?: Partial<ConsentFacts>;
}
const decide = (channel: string, purpose: PurposeInput, o: Opts = {}): ConsentGateResult =>
  decideConsent({
    purpose,
    channel,
    requireConsent: o.requireConsent ?? false,
    ...(o.minorRule ? { minorRule: o.minorRule } : {}),
    ...(o.replyWindowOpen ? { replyWindowOpen: true } : {}),
    facts: facts(o.f),
  });

describe('every broadcast channel has a consent channel of its own', () => {
  it.each(CHANNELS)('%s maps to itself, so a grant or a STOP on it is read', (channel) => {
    expect(consentChannelOfKind(channel)).toBe(channel);
  });
});

describe.each(CHANNELS)('ConsentGate truth table, marketing on %s', (channel) => {
  const marketing = 'marketing_messaging' as const;

  it('switch off (the default): only a withdrawal blocks', () => {
    expect(decide(channel, marketing)).toEqual({ decision: 'allow', reason: 'policy_off' });
    expect(decide(channel, marketing, { f: { ledgerState: 'granted' } }).decision).toBe('allow');
    expect(decide(channel, marketing, { f: { unsubscribedFlag: true } })).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
    expect(decide(channel, marketing, { f: { ledgerState: 'withdrawn' } })).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
  });

  it('switch on: a recorded grant on the channel is needed, a withdrawal still wins', () => {
    const on = { requireConsent: true };
    expect(decide(channel, marketing, on)).toEqual({
      decision: 'deny',
      reason: 'no_consent_recorded',
    });
    expect(decide(channel, marketing, { ...on, f: { ledgerState: 'granted' } })).toEqual({
      decision: 'allow',
      reason: 'granted',
    });
    expect(
      decide(channel, marketing, { ...on, f: { ledgerState: 'granted', unsubscribedFlag: true } }),
    ).toEqual({ decision: 'deny', reason: 'withdrawn' });
  });

  it('a flagged minor is held back by the workspace rule: block always, guardian until a parent agreed', () => {
    const minor = { minor: true };
    expect(decide(channel, marketing, { minorRule: 'off', f: minor }).decision).toBe('allow');
    expect(decide(channel, marketing, { minorRule: 'block', f: minor })).toEqual({
      decision: 'deny',
      reason: 'subject_minor',
    });
    expect(decide(channel, marketing, { minorRule: 'guardian', f: minor }).reason).toBe(
      'subject_minor',
    );
    expect(
      decide(channel, marketing, {
        minorRule: 'guardian',
        f: { minor: true, guardianConsent: true },
      }).decision,
    ).toBe('allow');
    // A minor is never a grant: with the switch on, guardian consent alone does not allow.
    expect(
      decide(channel, marketing, {
        requireConsent: true,
        minorRule: 'guardian',
        f: { minor: true, guardianConsent: true },
      }).reason,
    ).toBe('no_consent_recorded');
  });

  it('the Do-Not-Call list is for calls and texts; it never stops a message on this channel', () => {
    expect(decide(channel, marketing, { f: { onDncList: true } })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
  });

  it('service and utility messages are never blocked: STOP, the switch and a minor flag do not touch them', () => {
    const stopped = { unsubscribedFlag: true, minor: true };
    for (const purpose of ['service_messaging', 'utility'] as const) {
      expect(
        decide(channel, purpose, { requireConsent: true, minorRule: 'block', f: stopped }),
      ).toEqual({ decision: 'allow', reason: 'utility_exempt' });
    }
  });

  it('a reply inside the 24 hour window is allowed, even if the service purpose was withdrawn', () => {
    expect(
      decide(channel, 'service_messaging', {
        replyWindowOpen: true,
        f: { ledgerState: 'withdrawn' },
      }),
    ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
  });
});

/** A gate whose answers come from a table of contacts: the real rule, no database. */
function fakeGate(opts: {
  requireConsent?: boolean;
  minorRule?: MinorRule;
  contacts: Record<number, Partial<ConsentFacts>>;
}) {
  const asked: Array<{ ids: number[]; channel: string; purpose: PurposeInput }> = [];
  const anonymous: Array<{ channel: string; purpose: PurposeInput }> = [];
  const run = (channel: string, purpose: PurposeInput, f: Partial<ConsentFacts>) =>
    decideConsent({
      purpose,
      channel,
      requireConsent: opts.requireConsent ?? false,
      ...(opts.minorRule ? { minorRule: opts.minorRule } : {}),
      facts: facts(f),
    });
  const gate = {
    async checkMany(
      _org: number,
      ids: readonly number[],
      channel: string,
      purpose: PurposeInput,
    ): Promise<GateManyResult> {
      asked.push({ ids: [...ids], channel, purpose });
      const decisions = new Map<number, ConsentGateResult>();
      for (const id of new Set(ids))
        decisions.set(id, run(channel, purpose, opts.contacts[id] ?? {}));
      const allowed = new Set(
        [...decisions].filter(([, d]) => d.decision === 'allow').map(([i]) => i),
      );
      return { decisions, allowed, counts: {} };
    },
    async check(
      _org: number,
      subject: ConsentSubject,
      channel: string,
      purpose: PurposeInput,
    ): Promise<ConsentGateResult> {
      expect(subject).toEqual({ type: 'anonymous' });
      anonymous.push({ channel, purpose });
      return run(channel, purpose, {});
    },
  };
  return { gate: gate as unknown as ConsentGate, asked, anonymous };
}

const row = (id: number, contactId: number | null) => ({ id, contactId });

describe('gateRecipients', () => {
  it('asks once for the whole slice, as marketing, on the sender channel, and splits who goes', async () => {
    const { gate, asked, anonymous } = fakeGate({
      contacts: { 10: { unsubscribedFlag: true }, 11: {}, 12: { ledgerState: 'withdrawn' } },
    });
    const rows = [row(1, 10), row(2, 11), row(3, 12), row(4, 11)];
    const out = await gateRecipients(gate, 7, rows, 'telegram');
    expect(out.go.map((r) => r.id)).toEqual([2, 4]);
    expect(out.skipped.map((s) => [s.row.id, s.reason])).toEqual([
      [1, 'withdrawn'],
      [3, 'withdrawn'],
    ]);
    // One statement for the slice, never one per recipient, and no anonymous question when everyone is a contact.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ channel: 'telegram', purpose: 'marketing_messaging' });
    expect(anonymous).toEqual([]);
  });

  it('switch on: a contact with no grant is skipped, a granted one goes', async () => {
    const { gate } = fakeGate({
      requireConsent: true,
      contacts: { 1: { ledgerState: 'granted' }, 2: {} },
    });
    const out = await gateRecipients(gate, 7, [row(1, 1), row(2, 2)], 'facebook');
    expect(out.go.map((r) => r.id)).toEqual([1]);
    expect(out.skipped).toEqual([{ row: row(2, 2), reason: 'no_consent_recorded' }]);
  });

  it('the new reasons are carried through: a held-back minor', async () => {
    const { gate } = fakeGate({ minorRule: 'block', contacts: { 1: { minor: true }, 2: {} } });
    const out = await gateRecipients(gate, 7, [row(1, 1), row(2, 2)], 'viber');
    expect(out.skipped.map((s) => s.reason)).toEqual(['subject_minor']);
    expect(out.go.map((r) => r.id)).toEqual([2]);
  });

  it('a recipient with no contact is asked as an anonymous subject: allowed with the switch off, skipped with it on', async () => {
    const off = fakeGate({ contacts: {} });
    const a = await gateRecipients(off.gate, 7, [row(1, null), row(2, null)], 'line');
    expect(a.go).toHaveLength(2);
    expect(off.asked).toEqual([]);
    // One anonymous question for all of them.
    expect(off.anonymous).toHaveLength(1);

    const on = fakeGate({ requireConsent: true, contacts: {} });
    const b = await gateRecipients(on.gate, 7, [row(1, null)], 'wechat');
    expect(b.skipped).toEqual([{ row: row(1, null), reason: 'no_consent_recorded' }]);
  });

  it('no rows, no question', async () => {
    const { gate, asked, anonymous } = fakeGate({ contacts: {} });
    expect(await gateRecipients(gate, 7, [], 'telegram')).toEqual({ go: [], skipped: [] });
    expect(asked).toEqual([]);
    expect(anonymous).toEqual([]);
  });

  it('the purpose can be named, for a caller that is not a plain broadcast', async () => {
    const { gate, asked } = fakeGate({ contacts: { 1: { unsubscribedFlag: true } } });
    const out = await gateRecipients(gate, 7, [row(1, 1)], 'telegram', 'service_messaging');
    expect(asked[0]?.purpose).toBe('service_messaging');
    // A service message is not stopped by a marketing STOP.
    expect(out.go).toHaveLength(1);
  });

  it('a gate that cannot reach its database refuses marketing: nobody is messaged unchecked', async () => {
    const db = {
      txAs: () => Promise.reject(new Error('connection lost')),
    } as unknown as DatabaseService;
    const policy = {
      requiresConsent: () => Promise.resolve(false),
      minorRule: () => Promise.resolve('off' as MinorRule),
    } as unknown as ConsentPolicyService;
    const real = new ConsentGate(db, policy);
    const out = await gateRecipients(real, 7, [row(1, 5), row(2, null)], 'telegram');
    // The contact's facts could not be read: closed. The anonymous subject has no facts to read, so the switch (off) decides.
    expect(out.skipped).toEqual([{ row: row(1, 5), reason: 'gate_unavailable_closed' }]);
    expect(out.go.map((r) => r.id)).toEqual([2]);
  });
});

describe('the stable code of a skipped recipient', () => {
  it('survives a round trip for every reason the gate can give', () => {
    for (const reason of CONSENT_GATE_REASONS) {
      const note = consentSkipNote(reason);
      expect(note).toBe(`Not messaged: consent (${reason})`);
      expect(consentSkipReason(note)).toBe(reason);
    }
  });

  it('is not read out of any other text', () => {
    expect(consentSkipReason(null)).toBeNull();
    expect(consentSkipReason('Outside the 24-hour messaging window.')).toBeNull();
    expect(consentSkipReason('Not messaged: consent (Withdrawn!)')).toBeNull();
  });

  it('is counted per reason in the order they first appear', () => {
    expect(
      countSkipReasons([
        { reason: 'withdrawn' },
        { reason: 'subject_minor' },
        { reason: 'withdrawn' },
      ]),
    ).toEqual([
      { reason: 'withdrawn', count: 2 },
      { reason: 'subject_minor', count: 1 },
    ]);
    expect(countSkipReasons([])).toEqual([]);
  });
});
