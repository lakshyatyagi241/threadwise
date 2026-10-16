import { describe, expect, it } from 'vitest';
import {
  MARKET_SUBSCRIPTION_STATUSES,
  cancelOperatorSubscriptionSchema,
  compSubscriptionSchema,
  marketOperatorSubscriptionListQuerySchema,
} from '@crm/contracts';
import { ID, subscription, summaryRow } from '../test-fixtures';
import { SUBSCRIPTIONS_PATH, subscriptionsHref } from './paths';
import {
  ALL_APPS,
  COMP_MONTHS_MAX,
  appFromSearchParam,
  NO_SUBSCRIPTION_FILTERS,
  OPERATOR_NOTE_MAX,
  OPERATOR_NOTE_MIN,
  SUBSCRIPTION_SOURCE_FILTERS,
  SUBSCRIPTION_STATUS_FILTERS,
  SUBSCRIPTION_STATUS_TONE,
  canCancel,
  cancelCheck,
  cancelChoices,
  cancelPayload,
  compCheck,
  compPayload,
  initialCancelDraft,
  initialCompDraft,
  isFiltered,
  paidApps,
  parseMonths,
  periodInfo,
  subscriptionQuery,
  subscriptionStatusTone,
  sumCounts,
  type CompDraft,
} from './subscriptions';

describe('subscriptionQuery: what the API filters', () => {
  it('sends nothing for no filters', () => {
    expect(subscriptionQuery(NO_SUBSCRIPTION_FILTERS)).toEqual({});
    expect(isFiltered(NO_SUBSCRIPTION_FILTERS)).toBe(false);
  });

  it('sends the app, status, source and the trimmed workspace search', () => {
    expect(
      subscriptionQuery({
        app: 'acme-leads',
        status: 'canceling',
        source: 'comp',
        search: ' acme ',
      }),
    ).toEqual({ app: 'acme-leads', status: 'canceling', source: 'comp', q: 'acme' });
  });

  it('keeps the search within 80 characters and drops a blank one', () => {
    expect(
      subscriptionQuery({ ...NO_SUBSCRIPTION_FILTERS, search: 'x'.repeat(120) }).q,
    ).toHaveLength(80);
    expect(subscriptionQuery({ ...NO_SUBSCRIPTION_FILTERS, search: '   ' })).toEqual({});
  });

  it('every query it can build is accepted by the contract', () => {
    for (const status of SUBSCRIPTION_STATUS_FILTERS)
      for (const source of SUBSCRIPTION_SOURCE_FILTERS) {
        const q = subscriptionQuery({ app: 'acme-leads', status, source, search: 'a' });
        expect(marketOperatorSubscriptionListQuerySchema.safeParse(q).success).toBe(true);
      }
    expect(
      marketOperatorSubscriptionListQuerySchema.safeParse(
        subscriptionQuery({
          ...NO_SUBSCRIPTION_FILTERS,
          app: ID(1),
        }),
      ).success,
    ).toBe(true);
  });

  it('reads ?app= of the address only when it is an app slug or uuid', () => {
    expect(appFromSearchParam('acme-leads')).toBe('acme-leads');
    expect(appFromSearchParam(ID(1))).toBe(ID(1));
    expect(appFromSearchParam(['acme-leads', 'other'])).toBe('acme-leads');
    expect(appFromSearchParam(undefined)).toBeUndefined();
    expect(appFromSearchParam('')).toBeUndefined();
    expect(appFromSearchParam('Not A Slug!')).toBeUndefined();
    expect(appFromSearchParam("x'; drop table")).toBeUndefined();
  });

  it('says it is filtered when any filter is set', () => {
    expect(isFiltered({ ...NO_SUBSCRIPTION_FILTERS, app: 'acme-leads' })).toBe(true);
    expect(isFiltered({ ...NO_SUBSCRIPTION_FILTERS, status: 'ended' })).toBe(true);
    expect(isFiltered({ ...NO_SUBSCRIPTION_FILTERS, source: 'trial' })).toBe(true);
    expect(isFiltered({ ...NO_SUBSCRIPTION_FILTERS, search: ' x' })).toBe(true);
    expect(isFiltered({ ...NO_SUBSCRIPTION_FILTERS, search: '  ' })).toBe(false);
    expect(ALL_APPS).toBe('all');
  });

  it('opens the page on one app by an address the route reads', () => {
    expect(SUBSCRIPTIONS_PATH).toBe('/admin/marketplace/subscriptions');
    expect(subscriptionsHref('acme-leads')).toBe('/admin/marketplace/subscriptions?app=acme-leads');
    expect(subscriptionsHref('a b')).toBe('/admin/marketplace/subscriptions?app=a%20b');
  });
});

describe('subscriptionStatusTone', () => {
  it('has a badge for every state the API can answer', () => {
    for (const s of MARKET_SUBSCRIPTION_STATUSES) {
      expect(['neutral', 'success', 'warning', 'danger']).toContain(subscriptionStatusTone(s));
    }
    expect(Object.keys(SUBSCRIPTION_STATUS_TONE).sort()).toEqual(
      [...MARKET_SUBSCRIPTION_STATUSES].sort(),
    );
  });

  it('green for a paying one, amber for one on its way out, plain for the rest', () => {
    expect(subscriptionStatusTone('active')).toBe('success');
    expect(subscriptionStatusTone('canceling')).toBe('warning');
    expect(subscriptionStatusTone('ended')).toBe('neutral');
    expect(subscriptionStatusTone('trialing')).toBe('neutral');
    expect(subscriptionStatusTone('comped')).toBe('neutral');
  });
});

describe('periodInfo: what the renewal column says', () => {
  const END = '2026-11-01T10:00:00.000Z';
  it('a paying subscription is paid until its period end (nothing renews by itself)', () => {
    expect(periodInfo(subscription({ status: 'active', currentPeriodEnd: END }))).toEqual({
      kind: 'paidUntil',
      date: END,
    });
    expect(periodInfo(subscription({ status: 'active', currentPeriodEnd: null }))).toEqual({
      kind: 'none',
      date: null,
    });
  });

  it('a trial shows when it ends, falling back to the period end', () => {
    const t = '2026-10-10T00:00:00.000Z';
    expect(
      periodInfo(subscription({ status: 'trialing', trialEndsAt: t, currentPeriodEnd: END })),
    ).toEqual({ kind: 'trialEnds', date: t });
    expect(
      periodInfo(subscription({ status: 'trialing', trialEndsAt: null, currentPeriodEnd: END })),
    ).toEqual({ kind: 'trialEnds', date: END });
  });

  it('a cancelling one shows when access stops', () => {
    expect(periodInfo(subscription({ status: 'canceling', currentPeriodEnd: END }))).toEqual({
      kind: 'endsOn',
      date: END,
    });
  });

  it('a comp shows its end, or says it has none', () => {
    expect(periodInfo(subscription({ status: 'comped', currentPeriodEnd: END }))).toEqual({
      kind: 'compUntil',
      date: END,
    });
    expect(periodInfo(subscription({ status: 'comped', currentPeriodEnd: null }))).toEqual({
      kind: 'compOpen',
      date: null,
    });
  });

  it('an ended one shows when it ended, the lapse date first', () => {
    const lapsed = '2026-09-20T00:00:00.000Z';
    expect(
      periodInfo(subscription({ status: 'ended', lapsedAt: lapsed, currentPeriodEnd: END })),
    ).toEqual({ kind: 'endedOn', date: lapsed });
    expect(
      periodInfo(subscription({ status: 'ended', lapsedAt: null, currentPeriodEnd: END })),
    ).toEqual({ kind: 'endedOn', date: END });
    expect(
      periodInfo(subscription({ status: 'ended', lapsedAt: null, currentPeriodEnd: null })),
    ).toEqual({ kind: 'none', date: null });
  });
});

describe('cancelChoices: the same facts the API decides on', () => {
  it('a paying subscription with a period end can end then or now', () => {
    expect(cancelChoices(subscription({ status: 'active' }))).toEqual(['periodEnd', 'now']);
    expect(cancelChoices(subscription({ status: 'trialing' }))).toEqual(['periodEnd', 'now']);
    expect(cancelChoices(subscription({ status: 'comped' }))).toEqual(['periodEnd', 'now']);
  });

  it('one already ending can only be ended early', () => {
    expect(cancelChoices(subscription({ status: 'canceling' }))).toEqual(['now']);
  });

  it('one with no end date has no end of the period: it ends now', () => {
    expect(cancelChoices(subscription({ status: 'comped', currentPeriodEnd: null }))).toEqual([
      'now',
    ]);
  });

  it('an ended one has nothing to cancel, so the action is hidden', () => {
    expect(cancelChoices(subscription({ status: 'ended' }))).toEqual([]);
    expect(canCancel(subscription({ status: 'ended' }))).toBe(false);
    expect(canCancel(subscription({ status: 'active' }))).toBe(true);
  });
});

describe('the cancel form', () => {
  const sub = subscription({ status: 'active' });

  it('starts on the gentle option when there is one', () => {
    expect(initialCancelDraft(sub)).toEqual({ when: 'periodEnd', reason: '' });
    expect(initialCancelDraft(subscription({ status: 'canceling' }))).toEqual({
      when: 'now',
      reason: '',
    });
  });

  it('needs a reason of 5 to 300 characters after trimming', () => {
    const draft = (reason: string) => ({ when: 'periodEnd' as const, reason });
    expect(cancelCheck(sub, draft('')).canSubmit).toBe(false);
    expect(cancelCheck(sub, draft('  ab  ')).canSubmit).toBe(false);
    expect(cancelCheck(sub, draft('  abcde  ')).canSubmit).toBe(true);
    expect(cancelCheck(sub, draft('x'.repeat(OPERATOR_NOTE_MAX))).canSubmit).toBe(true);
    expect(cancelCheck(sub, draft('x'.repeat(OPERATOR_NOTE_MAX + 1))).canSubmit).toBe(false);
    expect(cancelCheck(sub, draft('abcde')).reason.length).toBe(5);
    expect(OPERATOR_NOTE_MIN).toBe(5);
  });

  it('does not allow a way the subscription does not offer', () => {
    expect(
      cancelCheck(subscription({ status: 'canceling' }), { when: 'periodEnd', reason: 'abcdef' })
        .canSubmit,
    ).toBe(false);
    expect(
      cancelCheck(subscription({ status: 'ended' }), { when: 'now', reason: 'abcdef' }).canSubmit,
    ).toBe(false);
  });

  it('builds the body the contract accepts', () => {
    const later = cancelPayload({ when: 'periodEnd', reason: '  Refund asked for  ' });
    expect(later).toEqual({ immediate: false, reason: 'Refund asked for' });
    expect(cancelPayload({ when: 'now', reason: 'Abuse reported' })).toEqual({
      immediate: true,
      reason: 'Abuse reported',
    });
    expect(cancelOperatorSubscriptionSchema.safeParse(later).success).toBe(true);
    expect(
      cancelOperatorSubscriptionSchema.safeParse(cancelPayload({ when: 'now', reason: 'abc' }))
        .success,
    ).toBe(false);
  });
});

describe('the comp form', () => {
  const ok: CompDraft = {
    app: 'acme-leads',
    workspaceId: ID(50),
    duration: 'months',
    months: '6',
    note: 'Partner pilot',
  };

  it('starts empty on three months, on the app that was filtered', () => {
    expect(initialCompDraft()).toEqual({
      app: '',
      workspaceId: '',
      duration: 'months',
      months: '3',
      note: '',
    });
    expect(initialCompDraft('acme-leads').app).toBe('acme-leads');
  });

  it('reads whole months from 1 to 36', () => {
    expect(parseMonths('1')).toBe(1);
    expect(parseMonths(' 36 ')).toBe(36);
    expect(parseMonths('0')).toBeNull();
    expect(parseMonths('37')).toBeNull();
    expect(parseMonths('2.5')).toBeNull();
    expect(parseMonths('')).toBeNull();
    expect(parseMonths('abc')).toBeNull();
    expect(COMP_MONTHS_MAX).toBe(36);
  });

  it('needs an app, a workspace, a valid length and a note', () => {
    expect(compCheck(ok).canSubmit).toBe(true);
    expect(compCheck({ ...ok, app: '' })).toMatchObject({ app: false, canSubmit: false });
    expect(compCheck({ ...ok, workspaceId: '' })).toMatchObject({
      workspace: false,
      canSubmit: false,
    });
    expect(compCheck({ ...ok, workspaceId: 'not-a-uuid' }).workspace).toBe(false);
    expect(compCheck({ ...ok, months: '40' })).toMatchObject({ months: false, canSubmit: false });
    expect(compCheck({ ...ok, note: 'abc' }).note.tooShort).toBe(true);
    expect(compCheck({ ...ok, note: 'x'.repeat(301) }).note.tooLong).toBe(true);
  });

  it('"until I end it" needs no number of months', () => {
    expect(compCheck({ ...ok, duration: 'open', months: 'junk' }).canSubmit).toBe(true);
  });

  it('builds the body the contract accepts, months or open-ended', () => {
    const months = compPayload(ok);
    expect(months).toEqual({ workspaceId: ID(50), months: 6, note: 'Partner pilot' });
    const open = compPayload({ ...ok, duration: 'open' });
    expect(open).toEqual({ workspaceId: ID(50), months: null, note: 'Partner pilot' });
    expect(compSubscriptionSchema.safeParse(months).success).toBe(true);
    expect(compSubscriptionSchema.safeParse(open).success).toBe(true);
  });

  it('every draft the check lets through is accepted by the contract and every one it refuses is not', () => {
    for (const workspaceId of ['', ID(50), 'x'])
      for (const duration of ['months', 'open'] as const)
        for (const months of ['', '0', '1', '36', '37'])
          for (const note of ['', 'abcd', 'abcde', 'x'.repeat(300), 'x'.repeat(301)]) {
            const d: CompDraft = { app: 'a', workspaceId, duration, months, note };
            expect(compCheck(d).canSubmit, JSON.stringify(d)).toBe(
              compSubscriptionSchema.safeParse(compPayload(d)).success,
            );
          }
  });
});

describe('the summary', () => {
  it('offers only paid apps to comp on', () => {
    const rows = [
      summaryRow({ slug: 'paid-one', name: 'Paid One' }),
      summaryRow({
        slug: 'was-paid',
        name: 'Was Paid',
        pricing: { model: 'free', amount: null, currency: null },
      }),
    ];
    expect(paidApps(rows)).toEqual([{ slug: 'paid-one', name: 'Paid One' }]);
    expect(paidApps([])).toEqual([]);
  });

  it('adds the counts of every app', () => {
    const rows = [
      summaryRow({
        counts: {
          active: 5,
          trialing: 2,
          comped: 1,
          canceling: 1,
          pastDue: 1,
          ended: 3,
          total: 12,
        },
      }),
      summaryRow({
        counts: { active: 1, trialing: 0, comped: 2, canceling: 0, pastDue: 0, ended: 1, total: 4 },
      }),
    ];
    expect(sumCounts(rows)).toEqual({
      active: 6,
      trialing: 2,
      comped: 3,
      canceling: 1,
      pastDue: 1,
      ended: 4,
      total: 16,
    });
    expect(sumCounts([])).toEqual({
      active: 0,
      trialing: 0,
      comped: 0,
      canceling: 0,
      pastDue: 0,
      ended: 0,
      total: 0,
    });
  });
});
