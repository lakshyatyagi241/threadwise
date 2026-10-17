import { describe, expect, it } from 'vitest';
import {
  SenderSharesService,
  type RunSender,
} from '../../../src/modules/campaigns/sender-shares.service';
import {
  EMPTY_WIZARD_DRAFT,
  senderSplit,
  senderWeight,
  splitAudience,
  splitSizes,
  wizardDraftSchema,
  wizardSenderPicks,
  wizardStepIssues,
} from '@crm/contracts';

describe('the share split across several numbers (TW-BCAST-006 / 014 in the wizard)', () => {
  it('weights 2/1/1 over 8 contacts give 4/2/2', () => {
    expect(splitSizes(8, [2, 1, 1])).toEqual([4, 2, 2]);
  });

  it('a missing, zero, negative or non-numeric weight counts as 1', () => {
    expect(senderWeight(undefined)).toBe(1);
    expect(senderWeight(0)).toBe(1);
    expect(senderWeight(-3)).toBe(1);
    expect(senderWeight(Number.NaN)).toBe(1);
    expect(senderWeight(7)).toBe(7);
    expect(splitSizes(10, [0, 5])).toEqual([2, 8]);
  });

  it('the sizes always add up, each within one of the exact share, the leftover to the largest fraction then the first picked', () => {
    for (const total of [0, 1, 2, 7, 10, 99, 1000]) {
      for (const weights of [[1], [1, 1], [1, 1, 1], [7, 3], [5, 2, 2, 1], [1, 1000]]) {
        const sizes = splitSizes(total, weights);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
        const sum = weights.reduce((a, b) => a + b, 0);
        sizes.forEach((s, i) => expect(Math.abs(s - (weights[i]! / sum) * total)).toBeLessThan(1));
      }
    }
    expect(splitSizes(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('splitAudience cuts sequential slices: every contact is in exactly one', () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const parts = splitAudience(items, [2, 1, 1]);
    expect(parts).toEqual([
      [0, 1, 2, 3],
      [4, 5],
      [6, 7],
    ]);
    expect(parts.flat()).toEqual(items);
  });

  it('fewer contacts than numbers leaves some slices empty', () => {
    expect(splitSizes(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(splitSizes(0, [1, 1])).toEqual([0, 0]);
    expect(splitSizes(5, [])).toEqual([]);
  });

  it('senderSplit reports weight, count and the percentage the picker shows beside each number', () => {
    expect(senderSplit(8, ['a', 'b', 'c'], { a: 2, b: 1, c: 1 })).toEqual([
      { key: 'a', weight: 2, count: 4, percent: 50 },
      { key: 'b', weight: 1, count: 2, percent: 25 },
      { key: 'c', weight: 1, count: 2, percent: 25 },
    ]);
    // 7 and 3 over 100: the reference's 70% and 30%.
    expect(senderSplit(100, ['a', 'b'], { a: 7, b: 3 }).map((x) => x.percent)).toEqual([70, 30]);
    expect(senderSplit(5, ['a'], {})).toEqual([{ key: 'a', weight: 1, count: 5, percent: 100 }]);
  });
});

describe('the numbers a draft sends from', () => {
  const base = { senderKey: null as string | null };

  it('an old draft with only senderKey is one number; none is none', () => {
    expect(wizardSenderPicks({ ...base, senderKey: 'waba:a' })).toEqual(['waba:a']);
    expect(wizardSenderPicks(base)).toEqual([]);
  });

  it('senderKeys is the whole list when it is used, de-duplicated, first is primary', () => {
    expect(
      wizardSenderPicks({ senderKey: 'waba:a', senderKeys: ['waba:a', 'waba:b', 'waba:a'] }),
    ).toEqual(['waba:a', 'waba:b']);
  });

  it('a draft saved before the share picker still parses, with no extra numbers', () => {
    const d = wizardDraftSchema.parse({ name: 'x', senderKey: 'waba:a' });
    expect(d.senderKeys).toEqual([]);
    expect(d.senderShare).toEqual({});
    expect(EMPTY_WIZARD_DRAFT.senderKeys).toEqual([]);
  });

  it('a weight above the limit is refused; zero is allowed (it counts as 1)', () => {
    expect(wizardDraftSchema.safeParse({ senderShare: { 'waba:a': 1001 } }).success).toBe(false);
    expect(wizardDraftSchema.safeParse({ senderShare: { 'waba:a': 0 } }).success).toBe(true);
  });

  it('step 1 needs at least one number, from either field', () => {
    const issue = (d: object) =>
      wizardStepIssues(1, wizardDraftSchema.parse({ name: 'n', templateId: null, ...d }), {
        now: new Date(),
      }).some((i) => i.code === 'sender_required');
    expect(issue({})).toBe(true);
    expect(issue({ senderKey: 'waba:a' })).toBe(false);
    expect(issue({ senderKeys: ['waba:a', 'waba:b'] })).toBe(false);
  });

  it('follow-ups need every picked number to be a Cloud API number', () => {
    const follow = {
      trigger: 'not_replied',
      waitMinutes: 60,
      action: { kind: 'flow', flowId: '11111111-1111-4111-8111-111111111111' },
    };
    const d = (keys: string[]) =>
      wizardDraftSchema.parse({ senderKey: keys[0], senderKeys: keys, followUps: [follow] });
    const codes = (keys: string[]) =>
      wizardStepIssues(4, d(keys), { now: new Date() }).map((i) => i.code);
    expect(codes(['waba:a', 'waba:b'])).not.toContain('follow_up_cloud_api_only');
    expect(codes(['waba:a', 'twilio:b'])).toContain('follow_up_cloud_api_only');
  });
});

describe('cutting recipients across the picked numbers', () => {
  const svc = new SenderSharesService(null as never, null as never, null as never);
  const num = (id: number, provider: string, weight: number): RunSender => ({
    key: `${provider}:${id}`,
    provider,
    deviceId: id,
    label: `n${id}`,
    weight,
  });

  it('weights 2/1/1 over 8 contacts: 4/2/2 in contact order, each contact once, whatever the engine', () => {
    const ids = [11, 12, 13, 14, 15, 16, 17, 18];
    const out = svc.assign(ids, [num(1, 'waba', 2), num(2, 'baileys', 1), num(3, 'baileys', 1)]);
    expect([...out.keys()]).toEqual(ids);
    expect(ids.map((c) => `${out.get(c)!.provider}:${out.get(c)!.deviceId}`)).toEqual([
      ...Array(4).fill('waba:1'),
      ...Array(2).fill('baileys:2'),
      ...Array(2).fill('baileys:3'),
    ]);
  });

  it('one number (or none) assigns nobody: the campaign number sends them all', () => {
    expect(svc.assign([1, 2, 3], [num(1, 'waba', 1)]).size).toBe(0);
    expect(svc.assign([1, 2, 3], []).size).toBe(0);
  });
});
