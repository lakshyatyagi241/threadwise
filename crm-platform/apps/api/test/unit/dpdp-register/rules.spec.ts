import { describe, expect, it } from 'vitest';
import {
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CATALOG,
  DPDP_CODE_CHECKS,
  DPDP_CODE_CHECK_RESULTS,
  DPDP_LIVE_CHECKS,
  DPDP_PENALTY_TIERS,
  type DpdpCatalogItem,
  type DpdpCheckKey,
  type DpdpCheckResult,
  type DpdpCheckView,
  type DpdpItemStatus,
  type DpdpRegisterResponse,
} from '@crm/contracts';
import {
  MILESTONES,
  evaluate,
  resolveItemStatus,
  type AttestationRecord,
  type EvaluateInput,
} from '../../../src/modules/dpdp-register/rules';

const NOW = new Date('2026-12-01T00:00:00.000Z');

function catalogItem(id: string): DpdpCatalogItem {
  const found = DPDP_CATALOG.find((item) => item.id === id);
  if (!found) throw new Error(`no catalog item ${id}`);
  return found;
}

/** A catalog item with the given overrides, built on row 20 (no checks). */
function synthItem(id: string, over: Partial<DpdpCatalogItem> = {}): DpdpCatalogItem {
  return { ...catalogItem('r20'), id, ...over };
}

function checkView(result: DpdpCheckResult): DpdpCheckView {
  return { key: 'mfa.operators', source: 'live', result, detail: 'test' };
}

function checksWith(pass: number, fail: number, unknown: number): DpdpCheckView[] {
  return [
    ...Array.from({ length: pass }, () => checkView('pass')),
    ...Array.from({ length: fail }, () => checkView('fail')),
    ...Array.from({ length: unknown }, () => checkView('unknown')),
  ];
}

function run(over: Partial<EvaluateInput> = {}): DpdpRegisterResponse {
  return evaluate({ catalog: DPDP_CATALOG, probes: {}, attestations: [], now: NOW, ...over });
}

function allItems(response: DpdpRegisterResponse) {
  return response.groups.flatMap((group) => group.items);
}

function allChecks(response: DpdpRegisterResponse): DpdpCheckView[] {
  return allItems(response).flatMap((item) => item.checks);
}

function checkOf(response: DpdpRegisterResponse, itemId: string, key: DpdpCheckKey): DpdpCheckView {
  const item = allItems(response).find((candidate) => candidate.id === itemId);
  const check = item?.checks.find((candidate) => candidate.key === key);
  if (!check) throw new Error(`no check ${key} on ${itemId}`);
  return check;
}

function statusOf(response: DpdpRegisterResponse, itemId: string): DpdpItemStatus {
  const item = allItems(response).find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`no item ${itemId}`);
  return item.status;
}

function attestation(over: Partial<AttestationRecord> = {}): AttestationRecord {
  return {
    checkKey: 'governance.contacts_named',
    result: 'pass',
    note: 'Contacts named and published on the trust page.',
    evidenceUrl: null,
    byName: 'Asha Operator',
    attestedAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('resolveItemStatus', () => {
  const withChecks = catalogItem('r28');

  it.each([
    [2, 0, 0, 'following'],
    [1, 0, 1, 'unverified'],
    [0, 0, 2, 'unverified'],
    [1, 1, 0, 'partial'],
    [0, 1, 1, 'partial'],
    [0, 2, 0, 'not_following'],
  ] as const)('P=%i F=%i U=%i resolves to %s', (pass, fail, unknown, expected) => {
    expect(resolveItemStatus(withChecks, checksWith(pass, fail, unknown))).toBe(expected);
  });

  it('an item with no checks takes its baseline', () => {
    expect(resolveItemStatus(catalogItem('r20'), [])).toBe('following');
    expect(resolveItemStatus(catalogItem('r44'), [])).toBe('not_following');
    expect(resolveItemStatus(synthItem('r90', { baseline: 'not_applicable' }), [])).toBe(
      'not_applicable',
    );
  });

  it('checks decide over the baseline', () => {
    // r28's baseline is partial, but two passes make it following and two fails make it not following.
    expect(withChecks.baseline).toBe('partial');
    expect(resolveItemStatus(withChecks, checksWith(2, 0, 0))).toBe('following');
    expect(resolveItemStatus(withChecks, checksWith(0, 2, 0))).toBe('not_following');
  });
});

describe('live checks', () => {
  it('a missing live probe is unknown, not pass', () => {
    const live = allChecks(run({ probes: {} })).filter((check) => check.source === 'live');
    expect(new Set(live.map((check) => check.key))).toEqual(new Set(DPDP_LIVE_CHECKS));
    for (const check of live) {
      expect(check.result, check.key).toBe('unknown');
      expect(check.detail, check.key).toBe('probe_missing');
    }
  });

  it('a probe outcome passes its result, detail and params through', () => {
    const response = run({
      probes: {
        'logs.audit_retention': { result: 'pass', detail: 'retention_days', params: { days: 365 } },
        'mfa.operators': { result: 'fail', detail: 'policy_off' },
      },
    });
    expect(checkOf(response, 'r25', 'logs.audit_retention')).toStrictEqual({
      key: 'logs.audit_retention',
      source: 'live',
      result: 'pass',
      detail: 'retention_days',
      params: { days: 365 },
    });
    expect(checkOf(response, 'r28', 'mfa.operators')).toStrictEqual({
      key: 'mfa.operators',
      source: 'live',
      result: 'fail',
      detail: 'policy_off',
    });
  });

  it('a passing probe alone makes an item with only that check following', () => {
    // A synthetic item decided by lifecycle.enabled alone (the real r26 also carries a code check).
    const catalog = [synthItem('r98', { checks: ['lifecycle.enabled'] })];
    expect(statusOf(run({ catalog }), 'r98')).toBe('unverified');
    const response = run({
      catalog,
      probes: { 'lifecycle.enabled': { result: 'pass', detail: 'enabled' } },
    });
    expect(statusOf(response, 'r98')).toBe('following');
  });

  it('a passing probe does not make r26 following while its code check fails', () => {
    const response = run({
      probes: { 'lifecycle.enabled': { result: 'pass', detail: 'enabled' } },
    });
    expect(checkOf(response, 'r26', 'lifecycle.exit_and_orphans_fixed').result).toBe('fail');
    expect(statusOf(response, 'r26')).toBe('partial');
  });
});

describe('code checks', () => {
  it('code checks always carry their declared result and the source code', () => {
    const code = allChecks(run()).filter((check) => check.source === 'code');
    expect(new Set(code.map((check) => check.key))).toEqual(new Set(DPDP_CODE_CHECKS));
    for (const check of code) {
      expect(check.result, check.key).toBe(
        DPDP_CODE_CHECK_RESULTS[check.key as keyof typeof DPDP_CODE_CHECK_RESULTS],
      );
      expect(check.detail, check.key).toBe('code_declared');
    }
  });

  it('are not changed by probes or attestations', () => {
    const everyProbePasses: EvaluateInput['probes'] = {};
    for (const key of DPDP_LIVE_CHECKS) everyProbePasses[key] = { result: 'pass', detail: 'ok' };
    const everyAttestationPasses = DPDP_ATTESTABLE_CHECKS.map((checkKey) =>
      attestation({ checkKey }),
    );
    const response = run({ probes: everyProbePasses, attestations: everyAttestationPasses });
    for (const check of allChecks(response).filter((c) => c.source === 'code')) {
      expect(check.result, check.key).toBe(
        DPDP_CODE_CHECK_RESULTS[check.key as keyof typeof DPDP_CODE_CHECK_RESULTS],
      );
    }
    // r28 has two passing probes and one failing code check, so a code gap keeps it from following.
    expect(statusOf(response, 'r28')).toBe('partial');
  });
});

describe('attested checks', () => {
  const key = 'governance.contacts_named';
  const expiresAt = new Date('2026-12-01T00:00:00.000Z');
  const record = attestation({ expiresAt });
  const checkAt = (now: Date) => checkOf(run({ attestations: [record], now }), 'r47', key);

  it('an attested pass counts only until it expires', () => {
    const atExpiry = checkAt(expiresAt);
    expect(atExpiry.result).toBe('unknown');
    expect(atExpiry.detail).toBe('attestation_expired');

    const afterExpiry = checkAt(new Date(expiresAt.getTime() + 1));
    expect(afterExpiry.result).toBe('unknown');
    expect(afterExpiry.detail).toBe('attestation_expired');

    const beforeExpiry = checkAt(new Date(expiresAt.getTime() - 1));
    expect(beforeExpiry.result).toBe('pass');
    expect(beforeExpiry.source).toBe('attested');
  });

  it('an unexpired attestation shows who recorded it, with ISO times', () => {
    const check = checkAt(new Date(expiresAt.getTime() - 1));
    expect(check.detail).toBe('attested_pass');
    expect(check.attestation).toStrictEqual({
      result: 'pass',
      note: 'Contacts named and published on the trust page.',
      evidenceUrl: null,
      byName: 'Asha Operator',
      at: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('an unexpired attested fail is a fail', () => {
    const response = run({ attestations: [attestation({ result: 'fail' })] });
    const check = checkOf(response, 'r47', key);
    expect(check.result).toBe('fail');
    expect(check.detail).toBe('attested_fail');
    expect(statusOf(response, 'r47')).toBe('not_following');
  });

  it('an expired attestation still shows the lapsed record', () => {
    const check = checkAt(expiresAt);
    expect(check.attestation?.expiresAt).toBe('2026-12-01T00:00:00.000Z');
  });

  it('a check with no attestation is unknown with attestation_missing', () => {
    const response = run({ attestations: [] });
    const check = checkOf(response, 'r47', key);
    expect(check.source).toBe('attested');
    expect(check.result).toBe('unknown');
    expect(check.detail).toBe('attestation_missing');
    expect(check.attestation).toBeUndefined();
    // The unattested contacts are unknown, and r47 also carries a code check for the unbuilt grievance intake, which fails.
    expect(statusOf(response, 'r47')).toBe('partial');
  });

  it('an attestation for another key does not count', () => {
    const response = run({ attestations: [attestation({ checkKey: 'legal.counsel_engaged' })] });
    expect(checkOf(response, 'r47', key).detail).toBe('attestation_missing');
    expect(checkOf(response, 'r45', 'legal.counsel_engaged').result).toBe('pass');
  });

  it('the newest attestation wins', () => {
    const older = attestation({ result: 'fail', attestedAt: new Date('2026-10-01T00:00:00.000Z') });
    const newer = attestation({ result: 'pass', attestedAt: new Date('2026-11-01T00:00:00.000Z') });
    expect(checkOf(run({ attestations: [older, newer] }), 'r47', key).result).toBe('pass');
    expect(checkOf(run({ attestations: [newer, older] }), 'r47', key).result).toBe('pass');
  });

  it('with equal times the later record in the list wins', () => {
    const at = new Date('2026-11-01T00:00:00.000Z');
    const fail = attestation({ result: 'fail', attestedAt: at });
    const pass = attestation({ result: 'pass', attestedAt: at });
    expect(checkOf(run({ attestations: [fail, pass] }), 'r47', key).result).toBe('pass');
    expect(checkOf(run({ attestations: [pass, fail] }), 'r47', key).result).toBe('fail');
  });

  it('an expired newest attestation is not rescued by an older one that has not expired', () => {
    const older = attestation({
      attestedAt: new Date('2026-10-01T00:00:00.000Z'),
      expiresAt: new Date('2027-06-01T00:00:00.000Z'),
    });
    const newer = attestation({
      result: 'fail',
      attestedAt: new Date('2026-11-01T00:00:00.000Z'),
      expiresAt: new Date('2026-11-15T00:00:00.000Z'),
    });
    const check = checkOf(run({ attestations: [older, newer] }), 'r47', key);
    expect(check.result).toBe('unknown');
    expect(check.detail).toBe('attestation_expired');
  });

  it('does not change the attestations it was given', () => {
    const records = [
      attestation({ attestedAt: new Date('2026-10-01T00:00:00.000Z') }),
      attestation(),
    ];
    const before = records.map((r) => r.attestedAt.getTime());
    run({ attestations: records });
    expect(records.map((r) => r.attestedAt.getTime())).toEqual(before);
  });

  it('an item whose checks all pass is following', () => {
    // r43 is decided by legal.vendor_dpas alone.
    expect(statusOf(run(), 'r43')).toBe('unverified');
    const response = run({ attestations: [attestation({ checkKey: 'legal.vendor_dpas' })] });
    expect(statusOf(response, 'r43')).toBe('following');
  });
});

describe('summary', () => {
  it('counts the whole catalog', () => {
    const response = run();
    const { summary } = response;
    expect(summary.total).toBe(47);
    expect(summary.following + summary.partial + summary.notFollowing + summary.unverified).toBe(
      summary.total,
    );
    expect(allItems(response)).toHaveLength(47);
  });

  it('counts each status from the items shown', () => {
    const response = run({
      probes: { 'lifecycle.enabled': { result: 'pass', detail: 'enabled' } },
      attestations: [attestation()],
    });
    const items = allItems(response);
    const count = (status: DpdpItemStatus) => items.filter((i) => i.status === status).length;
    expect(response.summary).toMatchObject({
      following: count('following'),
      partial: count('partial'),
      notFollowing: count('not_following'),
      unverified: count('unverified'),
    });
  });

  it('byTier sums match for tier 250', () => {
    const response = run();
    const tier250 = allItems(response).filter((item) => item.penaltyTier === '250');
    const count = (status: DpdpItemStatus) => tier250.filter((i) => i.status === status).length;
    expect(tier250.length).toBeGreaterThan(0);
    expect(response.summary.byTier['250']).toEqual({
      notFollowing: count('not_following'),
      partial: count('partial'),
      unverified: count('unverified'),
    });
  });

  it('byTier has every tier and its counts add up to the open items', () => {
    const { summary } = run();
    expect(Object.keys(summary.byTier).sort()).toEqual([...DPDP_PENALTY_TIERS].sort());
    const open = Object.values(summary.byTier).reduce(
      (sum, tier) => sum + tier.notFollowing + tier.partial + tier.unverified,
      0,
    );
    expect(open).toBe(summary.total - summary.following);
  });

  it('keeps not_applicable items listed but out of every count', () => {
    const catalog = [
      synthItem('r91', { penaltyTier: '250', baseline: 'following' }),
      synthItem('r92', { penaltyTier: '250', baseline: 'partial' }),
      synthItem('r93', { penaltyTier: '250', baseline: 'not_following' }),
      synthItem('r94', {
        penaltyTier: '250',
        baseline: 'not_following',
        checks: ['mfa.operators'],
      }),
      synthItem('r95', { penaltyTier: '50', baseline: 'not_following' }),
      synthItem('r96', { penaltyTier: 'none', baseline: 'partial' }),
      synthItem('r97', { penaltyTier: '250', baseline: 'not_applicable' }),
    ];
    const response = run({ catalog });
    const na = allItems(response).find((item) => item.id === 'r97');
    expect(na?.status).toBe('not_applicable');
    expect(allItems(response)).toHaveLength(7);
    expect(statusOf(response, 'r94')).toBe('unverified');
    expect(response.summary).toEqual({
      total: 6,
      following: 1,
      partial: 2,
      notFollowing: 2,
      unverified: 1,
      byTier: {
        '250': { notFollowing: 1, partial: 1, unverified: 1 },
        '200': { notFollowing: 0, partial: 0, unverified: 0 },
        '150': { notFollowing: 0, partial: 0, unverified: 0 },
        '50': { notFollowing: 1, partial: 0, unverified: 0 },
        none: { notFollowing: 0, partial: 1, unverified: 0 },
      },
    });
  });
});

describe('item view', () => {
  it('copies the catalog fields and marks row 44 conditional', () => {
    const response = run();
    const r44 = allItems(response).find((item) => item.id === 'r44');
    expect(r44).toMatchObject({
      id: 'r44',
      group: 'H',
      citation: 's10, rule 13',
      owner: 'both',
      penaltyTier: '150',
      planItems: ['DP-80'],
      status: 'not_following',
      conditional: true,
      checks: [],
    });
    const r20 = allItems(response).find((item) => item.id === 'r20');
    expect(r20?.conditional).toBe(false);
    expect(r20?.status).toBe('following');
  });

  it('shows the checks of an item in the catalog order', () => {
    const response = run();
    const r42 = allItems(response).find((item) => item.id === 'r42');
    expect(r42?.checks.map((check) => check.key)).toEqual(catalogItem('r42').checks);
    expect(r42?.checks.map((check) => check.source)).toEqual(['attested', 'live', 'code']);
  });

  it('does not share the catalog arrays with the response', () => {
    const response = run();
    const r42 = allItems(response).find((item) => item.id === 'r42');
    expect(r42?.planItems).toEqual(catalogItem('r42').planItems);
    expect(r42?.planItems).not.toBe(catalogItem('r42').planItems);
  });
});

describe('order', () => {
  it('lists groups A to I and leaves out empty groups', () => {
    expect(run().groups.map((group) => group.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
    ]);
    const catalog = [
      synthItem('r11', { group: 'C' }),
      synthItem('r12', { group: 'A' }),
      synthItem('r13', { group: 'I' }),
    ];
    expect(run({ catalog }).groups.map((group) => group.id)).toEqual(['A', 'C', 'I']);
  });

  it('sorts items by status, then id', () => {
    const catalog = [
      synthItem('r05', { baseline: 'following' }),
      synthItem('r02', { baseline: 'not_applicable' }),
      synthItem('r06', { baseline: 'not_following' }),
      synthItem('r04', { baseline: 'partial', checks: ['mfa.operators'] }),
      synthItem('r03', { baseline: 'partial' }),
      synthItem('r01', { baseline: 'not_following' }),
      synthItem('r07', { baseline: 'partial' }),
    ];
    const [group] = run({ catalog }).groups;
    expect(group?.items.map((item) => `${item.id}:${item.status}`)).toEqual([
      'r01:not_following',
      'r06:not_following',
      'r03:partial',
      'r07:partial',
      'r04:unverified',
      'r05:following',
      'r02:not_applicable',
    ]);
  });
});

describe('milestones', () => {
  it('are the two commencement dates', () => {
    expect(MILESTONES).toEqual([
      { id: 'consent_managers', date: '2026-11-14' },
      { id: 'main_duties', date: '2027-05-14' },
    ]);
  });

  it('after the last date both are passed with 0 days left', () => {
    const { milestones } = run({ now: new Date('2027-05-15T08:00:00.000Z') });
    expect(milestones).toEqual([
      { id: 'consent_managers', date: '2026-11-14', daysLeft: 0, passed: true },
      { id: 'main_duties', date: '2027-05-14', daysLeft: 0, passed: true },
    ]);
  });

  it('a date 10 days away has 10 days left and is not passed', () => {
    const { milestones } = run({ now: new Date('2026-11-04T00:00:00.000Z') });
    expect(milestones[0]).toEqual({
      id: 'consent_managers',
      date: '2026-11-14',
      daysLeft: 10,
      passed: false,
    });
    expect(milestones[1]?.passed).toBe(false);
    expect(milestones[1]?.daysLeft).toBeGreaterThan(10);
  });

  it('rounds a part day up', () => {
    const halfWay = run({ now: new Date('2026-11-03T12:00:00.000Z') }).milestones[0];
    expect(halfWay?.daysLeft).toBe(11);
    const oneMsLeft = run({ now: new Date('2026-11-13T23:59:59.999Z') }).milestones[0];
    expect(oneMsLeft).toMatchObject({ daysLeft: 1, passed: false });
  });

  it('is passed on the date itself, at 00:00 UTC', () => {
    const onTheDay = run({ now: new Date('2026-11-14T00:00:00.000Z') }).milestones[0];
    expect(onTheDay).toMatchObject({ daysLeft: 0, passed: true });
  });

  it('never reports a negative number of days', () => {
    const { milestones } = run({ now: new Date('2030-01-01T00:00:00.000Z') });
    for (const milestone of milestones) expect(milestone.daysLeft).toBe(0);
  });
});

describe('generatedAt', () => {
  it('is now, as an ISO string', () => {
    expect(run().generatedAt).toBe('2026-12-01T00:00:00.000Z');
  });
});
