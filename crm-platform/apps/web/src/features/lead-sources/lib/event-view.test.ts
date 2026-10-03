import { describe, expect, it } from 'vitest';
import { LEAD_EVENT_STATUSES, LEAD_REASONS } from '@crm/contracts';
import { event, ID } from '../test-fixtures';
import {
  ATTENTION_STATUSES,
  EVENT_FILTERS,
  EVENT_STATUS_TONE,
  GUIDANCE_KEYS,
  attentionGroups,
  filtersFromLink,
  guidanceFor,
  isRetryable,
  isTestParam,
  mergeEvents,
  parseEventFilter,
  reasonView,
  statusesFor,
} from './event-view';

describe('status tones', () => {
  it('gives every status a tone: done is green, waiting is amber, failed is red', () => {
    for (const s of LEAD_EVENT_STATUSES) expect(EVENT_STATUS_TONE[s], s).toBeTypeOf('string');
    expect(EVENT_STATUS_TONE.created).toBe('success');
    expect(EVENT_STATUS_TONE.updated).toBe('success');
    expect(EVENT_STATUS_TONE.needs_review).toBe('warning');
    expect(EVENT_STATUS_TONE.failed).toBe('danger');
    expect(EVENT_STATUS_TONE.duplicate).toBe('neutral');
    expect(EVENT_STATUS_TONE.received).toBe('neutral');
  });

  it('the statuses that wait are needs_review and failed', () => {
    expect([...ATTENTION_STATUSES]).toEqual(['needs_review', 'failed']);
  });
});

describe('guidance for every status and reason', () => {
  const GUIDED = new Set(['needs_review', 'failed']);
  for (const status of LEAD_EVENT_STATUSES) {
    for (const reason of [...LEAD_REASONS, null, 'a_reason_from_the_future']) {
      it(`${status} / ${String(reason)}`, () => {
        const g = guidanceFor(status, reason);
        if (GUIDED.has(status)) {
          // A lead that waits always says what to do, even for a reason this build does not know.
          expect(g, 'waiting leads have advice').not.toBeNull();
          expect(GUIDANCE_KEYS).toContain(g!.key);
        } else if (reason === 'identity_conflict') {
          expect(g?.key).toBe('identityConflict');
        } else {
          expect(g).toBeNull();
        }
      });
    }
  }

  it('maps each reason to its own advice and offers the upgrade only for the contact limit', () => {
    expect(guidanceFor('needs_review', 'no_contact_point')).toEqual({
      key: 'noContactPoint',
      upgrade: false,
    });
    expect(guidanceFor('needs_review', 'invalid_phone')).toEqual({
      key: 'invalidPhone',
      upgrade: false,
    });
    expect(guidanceFor('needs_review', 'plan_limit_reached')).toEqual({
      key: 'planLimit',
      upgrade: true,
    });
    expect(guidanceFor('failed', 'internal_error')).toEqual({
      key: 'internalError',
      upgrade: false,
    });
    expect(guidanceFor('failed', 'source_paused')).toEqual({ key: 'sourcePaused', upgrade: false });
    expect(guidanceFor('needs_review', null)).toEqual({ key: 'generic', upgrade: false });
  });
});

describe('reasonView', () => {
  it('translates a known reason and shows an unknown one as written', () => {
    for (const r of LEAD_REASONS) expect(reasonView(r)).toEqual({ known: true, code: r });
    expect(reasonView('brand_new_reason')).toEqual({ known: false, raw: 'brand_new_reason' });
    expect(reasonView(null)).toBeNull();
    expect(reasonView('')).toBeNull();
  });
});

describe('retry', () => {
  it('only a waiting lead whose payload is still stored can be retried', () => {
    expect(isRetryable({ status: 'needs_review', hasPayload: true })).toBe(true);
    expect(isRetryable({ status: 'failed', hasPayload: true })).toBe(true);
    expect(isRetryable({ status: 'failed', hasPayload: false })).toBe(false);
    for (const s of ['received', 'created', 'updated', 'duplicate'] as const) {
      expect(isRetryable({ status: s, hasPayload: true }), s).toBe(false);
    }
  });
});

describe('filters', () => {
  it('asks the API for one status at a time, and for the two that wait separately', () => {
    expect(statusesFor('all')).toEqual([undefined]);
    expect(statusesFor('attention')).toEqual(['needs_review', 'failed']);
    expect(statusesFor('created')).toEqual(['created']);
    for (const f of EVENT_FILTERS) expect(statusesFor(f).length).toBeGreaterThan(0);
  });

  it('turns the test filter into the API parameter', () => {
    expect(isTestParam('all')).toBeUndefined();
    expect(isTestParam('only')).toBe('true');
    expect(isTestParam('hide')).toBe('false');
  });

  it('reads the address value, and the badge link hides the tests it does not count', () => {
    expect(parseEventFilter('needs_review')).toBe('needs_review');
    expect(parseEventFilter('nonsense')).toBe('all');
    expect(parseEventFilter(undefined)).toBe('all');
    expect(filtersFromLink('attention')).toEqual({ status: 'attention', tests: 'hide' });
    expect(filtersFromLink('failed')).toEqual({ status: 'failed', tests: 'all' });
  });
});

describe('merging the two waiting statuses', () => {
  it('lists newest first without repeating an event', () => {
    const a = event({ id: ID(1), status: 'needs_review', receivedAt: '2026-10-03T09:00:00.000Z' });
    const b = event({ id: ID(2), status: 'failed', receivedAt: '2026-10-03T10:00:00.000Z' });
    const c = event({ id: ID(3), status: 'needs_review', receivedAt: '2026-10-03T11:00:00.000Z' });
    expect(
      mergeEvents([
        [a, c],
        [b, a],
      ]).map((e) => e.id),
    ).toEqual([ID(3), ID(2), ID(1)]);
    expect(mergeEvents([[], []])).toEqual([]);
  });
});

describe('the attention banner', () => {
  it('groups the waiting leads by what to do, most first, ignoring tests and finished leads', () => {
    const events = [
      event({ id: ID(1), status: 'needs_review', reason: 'no_contact_point' }),
      event({ id: ID(2), status: 'needs_review', reason: 'no_contact_point' }),
      event({ id: ID(3), status: 'needs_review', reason: 'plan_limit_reached' }),
      event({ id: ID(4), status: 'needs_review', reason: 'no_contact_point', isTest: true }),
      event({ id: ID(5), status: 'created' }),
      event({ id: ID(6), status: 'failed', reason: 'internal_error' }),
    ];
    expect(attentionGroups(events)).toEqual([
      { key: 'noContactPoint', upgrade: false, count: 2 },
      { key: 'planLimit', upgrade: true, count: 1 },
      { key: 'internalError', upgrade: false, count: 1 },
    ]);
    expect(attentionGroups([])).toEqual([]);
  });
});
