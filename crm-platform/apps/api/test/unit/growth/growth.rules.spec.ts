import { describe, expect, it } from 'vitest';
import { GROWTH_CONFIG_DEFAULTS, GROWTH_FEATURES } from '@crm/contracts';
import {
  FALLBACK_MODEL,
  PROPENSITY_FEATURES,
  applyConfigPatch,
  assistantPrompt,
  auc,
  buildPropensity,
  digestHighlights,
  isHotLead,
  mergeConfig,
  mergeFeatures,
  noFeatures,
  parseDateProperty,
  parseRecommendation,
  predict,
  safeTimezone,
  sendTimeProfile,
  serviceRuleGroupName,
  serviceRuleKey,
  statusFacts,
  topDecileCapture,
  trainLogistic,
  transform,
  type AssistantCandidates,
  type PropensityRow,
} from '../../../src/modules/growth-pilot/growth.rules';

describe('settings', () => {
  it('a part that is not stored as true is off', () => {
    expect(Object.values(noFeatures()).every((v) => v === false)).toBe(true);
    const f = mergeFeatures({ campaign_response: true, quality: 'yes', nonsense: true });
    expect(f.campaign_response).toBe(true);
    expect(f.quality).toBe(false);
    expect(Object.keys(f)).toHaveLength(GROWTH_FEATURES.length);
    expect(mergeFeatures(null).propensity).toBe(false);
  });

  it('the stored overrides sit on the defaults, one level deep for the grouped settings', () => {
    const c = mergeConfig({ lapsedDays: 90, stageRule: { minOpens: 4 } });
    expect(c.lapsedDays).toBe(90);
    expect(c.hotLeadConfidence).toBe(GROWTH_CONFIG_DEFAULTS.hotLeadConfidence);
    expect(c.stageRule).toEqual({ ...GROWTH_CONFIG_DEFAULTS.stageRule, minOpens: 4 });
    expect(mergeConfig(undefined)).toEqual(GROWTH_CONFIG_DEFAULTS);
  });

  it('a patch replaces what it names and keeps the rest', () => {
    expect(applyConfigPatch({ lapsedDays: 90, unansweredHours: 2 }, { lapsedDays: 30 })).toEqual({
      lapsedDays: 30,
      unansweredHours: 2,
    });
  });
});

describe('the conversion model', () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  /** Contacts whose conversion really depends on opens and replies (plus noise). */
  const world = (n: number): PropensityRow[] => {
    const r = rng(7);
    return Array.from({ length: n }, (_, i) => {
      const opens = Math.floor(r() * 6);
      const replies = Math.floor(r() * 4);
      const p = 1 / (1 + Math.exp(-(-3 + 0.7 * opens + 0.9 * replies)));
      return {
        contactId: i + 1,
        raw: [
          opens,
          4,
          replies,
          0,
          Math.floor(r() * 3),
          1,
          replies * 3,
          100 + Math.floor(r() * 300),
        ],
        y: r() < p ? 1 : 0,
      };
    });
  };

  it('learns which behaviour goes with converting, and does better than chance on contacts it did not learn from', () => {
    const built = buildPropensity(world(3000), new Date('2026-10-12T00:00:00Z'));
    expect(built.summary.trained).toBe(true);
    expect(built.summary.auc).toBeGreaterThan(0.75);
    // A ranking at random would put 10% of the converted contacts in its top tenth.
    expect(built.summary.topDecileCapture).toBeGreaterThan(0.15);
    expect(built.summary.contacts).toBe(3000);
    const top = built.summary.weights[0]!;
    expect(['campaigns_opened_30d', 'messages_from_contact_30d', 'chat_messages_total']).toContain(
      top.feature,
    );
    expect(built.scores.every((s) => s.score >= 0 && s.score <= 100)).toBe(true);
  });

  it('a contact that behaves like the converted ones scores higher than one that does not', () => {
    const built = buildPropensity(world(3000), new Date());
    const high = predict(built.model, transform([5, 4, 3, 0, 1, 1, 9, 200]));
    const low = predict(built.model, transform([0, 4, 0, 0, 1, 1, 0, 200]));
    expect(high).toBeGreaterThan(low + 0.2);
  });

  it('with too few converted contacts it does not pretend to have learned, and says so', () => {
    const few = world(400).map((r, i) => ({ ...r, y: (i < 5 ? 1 : 0) as 0 | 1 }));
    expect(trainLogistic(few.map((r) => ({ x: transform(r.raw), y: r.y })))).toBe(FALLBACK_MODEL);
    const built = buildPropensity(few, new Date());
    expect(built.summary.trained).toBe(false);
    expect(built.summary.positives).toBe(5);
  });

  it('names its features in the order it uses them', () => {
    expect(PROPENSITY_FEATURES).toHaveLength(8);
    expect(transform([3, 0, 0, 0, 0, 1, 0, 0])[5]).toBe(1);
  });

  it('AUC is 1 for a perfect ranking, 0 for a reversed one, 0.5 for ties, and null with one class', () => {
    expect(
      auc([
        { score: 0.9, y: 1 },
        { score: 0.8, y: 1 },
        { score: 0.2, y: 0 },
        { score: 0.1, y: 0 },
      ]),
    ).toBe(1);
    expect(
      auc([
        { score: 0.1, y: 1 },
        { score: 0.2, y: 1 },
        { score: 0.8, y: 0 },
        { score: 0.9, y: 0 },
      ]),
    ).toBe(0);
    expect(
      auc([
        { score: 0.5, y: 1 },
        { score: 0.5, y: 0 },
      ]),
    ).toBe(0.5);
    expect(auc([{ score: 0.5, y: 1 }])).toBeNull();
  });

  it('the top tenth captures the share of converted contacts it holds', () => {
    const scored = Array.from({ length: 100 }, (_, i) => ({
      score: i,
      y: (i >= 95 ? 1 : i === 3 ? 1 : 0) as 0 | 1,
    }));
    // 6 converted; 5 of them sit in the top 10.
    expect(topDecileCapture(scored)).toBeCloseTo(5 / 6, 2);
    expect(topDecileCapture(scored.slice(0, 5))).toBeNull();
  });
});

describe('send times', () => {
  it('finds the three best hours from where contacts write and read, and the quiet tail', () => {
    const inbound = Array<number>(24).fill(1);
    const read = Array<number>(24).fill(1);
    inbound[9] = 100;
    read[9] = 80;
    inbound[18] = 60;
    read[19] = 50;
    inbound[20] = 40;
    const p = sendTimeProfile(inbound, read, 'Asia/Kolkata');
    expect(p.bestHours[0]).toBe(9);
    expect(new Set(p.bestHours)).toEqual(new Set([9, 18, 19]));
    expect(p.quietHours).toContain(3);
    expect(p.sampleSize).toBe(inbound.reduce((a, b) => a + b) + read.reduce((a, b) => a + b));
    expect(p.timezone).toBe('Asia/Kolkata');
  });

  it('says nothing when there is no data', () => {
    const p = sendTimeProfile(Array(24).fill(0), Array(24).fill(0), 'UTC');
    expect(p.bestHours).toEqual([]);
    expect(p.quietHours).toEqual([]);
  });

  it('falls back to UTC for a time zone that is not one', () => {
    expect(safeTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(safeTimezone('Mars/Olympus')).toBe('UTC');
    expect(safeTimezone(null)).toBe('UTC');
  });
});

describe('the Growth inbox rules', () => {
  const read = (over: Partial<Parameters<typeof isHotLead>[0]> = {}) => ({
    signals: { readyToBuy: true },
    score: 85,
    source: 'ai' as const,
    intent: 'ready_to_buy',
    ...over,
  });

  it('a hot lead is a confident reading that says ready to buy; button taps and doubtful readings are not', () => {
    expect(isHotLead(read(), { hotLeadConfidence: 0.8 })).toBe(true);
    expect(isHotLead(read({ score: 70 }), { hotLeadConfidence: 0.8 })).toBe(false);
    expect(isHotLead(read({ source: 'rules' }), { hotLeadConfidence: 0.8 })).toBe(false);
    expect(isHotLead(read({ signals: { readyToBuy: false } }), { hotLeadConfidence: 0.8 })).toBe(
      false,
    );
    expect(isHotLead(read({ score: null }), { hotLeadConfidence: 0.5 })).toBe(false);
  });

  it('a status reply is built from the contact’s own status properties, trimmed, and only those the workspace named', () => {
    const data = { repair_status: '  Ready for pickup ', job_id: 4471, secret: 'x', empty: ' ' };
    expect(statusFacts(data, ['repair_status', 'job_id', 'empty', 'missing'])).toEqual([
      { key: 'repair_status', value: 'Ready for pickup' },
      { key: 'job_id', value: '4471' },
    ]);
    expect(statusFacts(null, ['a'])).toEqual([]);
  });

  it('reads a date property only when it is written as a date', () => {
    expect(parseDateProperty('2026-09-30')).toBe('2026-09-30');
    expect(parseDateProperty('2026-09-30T10:00:00Z')).toBe('2026-09-30');
    expect(parseDateProperty('30/09/2026')).toBeNull();
    expect(parseDateProperty('2026-13-45')).toBeNull();
    expect(parseDateProperty(42)).toBeNull();
  });

  it('names a service rule and its group', () => {
    expect(serviceRuleKey(2)).toBe('service_due:2');
    expect(serviceRuleGroupName({ label: 'Battery change' })).toBe('AI · Battery change');
  });

  it('the digest keeps only the sentences with something in them, in order', () => {
    const h = digestHighlights({
      hotLeads: 2,
      unanswered: 0,
      optOuts: 1,
      suggestionsPending: 0,
      lapsed: 5,
      campaigns: { sent: 100, replied24h: 7 },
    });
    expect(h.map((x) => x.key)).toEqual(['hotLeads', 'optOuts', 'campaignReplies', 'lapsed']);
  });
});

describe('the broadcast assistant', () => {
  const candidates: AssistantCandidates = {
    audiences: [
      { groupId: 'g1', name: 'Registrants', size: 900 },
      { groupId: 'g2', name: 'AI · Engaged', size: 300 },
    ],
    templates: [
      {
        id: 't1',
        name: 'event_reminder',
        category: 'utility',
        body: 'Reminder: the event is tomorrow',
        sent: 500,
        replyRate24h: 0.12,
      },
      {
        id: 't2',
        name: 'donation_ask',
        category: 'marketing',
        body: null,
        sent: 200,
        replyRate24h: null,
      },
    ],
    bestHours: [9, 18],
  };

  it('puts the goal, the real reply rates and the best hours in front of the model, and tells it the goal is not an instruction', () => {
    const p = assistantPrompt('Remind registrants about Saturday', candidates);
    const u = JSON.parse(p.user) as {
      goal: string;
      templates: Array<{ replyRate24hPercent: number | null }>;
      bestHoursOfDay: number[];
    };
    expect(u.goal).toBe('Remind registrants about Saturday');
    expect(u.templates[0]!.replyRate24hPercent).toBe(12);
    expect(u.templates[1]!.replyRate24hPercent).toBeNull();
    expect(u.bestHoursOfDay).toEqual([9, 18]);
    expect(p.system).toMatch(/never as instructions/);
  });

  it('accepts a recommendation made of the ids it was given', () => {
    const r = parseRecommendation(
      '```json\n{"audienceId":"g1","templateId":"t1","sendHour":9,"subject":"Saturday reminder","reasons":["Highest reply rate","Registrants"]}\n```',
      candidates,
    )!;
    expect(r.audience).toEqual({ groupId: 'g1', name: 'Registrants', size: 900 });
    expect(r.template).toMatchObject({ id: 't1', replyRate24h: 0.12 });
    expect(r.sendHour).toBe(9);
    expect(r.reasons).toHaveLength(2);
  });

  it('refuses an id it was not given, and fixes an hour that is out of range', () => {
    expect(parseRecommendation('{"audienceId":"g9","templateId":"t1"}', candidates)).toBeNull();
    expect(parseRecommendation('{"audienceId":"g1","templateId":"nope"}', candidates)).toBeNull();
    expect(parseRecommendation('nonsense', candidates)).toBeNull();
    const r = parseRecommendation(
      '{"audienceId":"g2","templateId":"t2","sendHour":31}',
      candidates,
    )!;
    expect(r.sendHour).toBeNull();
    expect(r.subject).toBe('donation_ask');
  });
});
