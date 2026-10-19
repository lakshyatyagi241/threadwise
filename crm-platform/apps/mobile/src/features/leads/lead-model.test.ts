import { LEAD_REASONS } from '@crm/contracts';
import {
  facebookForm,
  pausedLanding,
  purgedReview,
  reviewLead,
  createdLead,
} from '@/test/leads-fixtures';
import {
  EVENT_STATUS_TONE,
  guidanceFor,
  isAttentionStatus,
  isRetryable,
  reasonView,
  statusOfFilter,
  totalNeedingAttention,
} from './lead-model';

describe('which leads wait for a person', () => {
  it('counts needs_review and failed as waiting, nothing else', () => {
    expect(isAttentionStatus('needs_review')).toBe(true);
    expect(isAttentionStatus('failed')).toBe(true);
    for (const status of ['received', 'created', 'updated', 'duplicate'] as const)
      expect(isAttentionStatus(status)).toBe(false);
  });

  it('retries only a waiting lead whose stored data is still there', () => {
    expect(isRetryable(reviewLead)).toBe(true);
    expect(isRetryable(purgedReview)).toBe(false);
    expect(isRetryable(createdLead)).toBe(false);
  });

  it('colours a status by what it means', () => {
    expect(EVENT_STATUS_TONE.created).toBe('success');
    expect(EVENT_STATUS_TONE.needs_review).toBe('warning');
    expect(EVENT_STATUS_TONE.failed).toBe('danger');
  });

  it('adds the numbers of every source', () => {
    expect(totalNeedingAttention([facebookForm, pausedLanding])).toBe(2);
    expect(totalNeedingAttention([])).toBe(0);
  });
});

describe('advice for a lead', () => {
  it('has advice for every known reason of a lead that waits', () => {
    for (const reason of LEAD_REASONS) {
      expect(guidanceFor('needs_review', reason)).not.toBeNull();
      expect(guidanceFor('failed', reason)).not.toBeNull();
    }
    expect(guidanceFor('needs_review', 'no_contact_point')).toBe('noContactPoint');
    expect(guidanceFor('failed', 'plan_limit_reached')).toBe('planLimit');
  });

  it('falls back to generic advice for a reason this build does not know', () => {
    expect(guidanceFor('failed', 'something_new')).toBe('generic');
    expect(guidanceFor('needs_review', null)).toBe('generic');
  });

  it('says something about a finished lead only for an identity conflict', () => {
    expect(guidanceFor('created', 'identity_conflict')).toBe('identityConflict');
    expect(guidanceFor('created', null)).toBeNull();
    expect(guidanceFor('duplicate', 'source_paused')).toBeNull();
  });

  it('shows a known reason as a code and an unknown one as the server wrote it', () => {
    expect(reasonView('invalid_phone')).toEqual({ known: true, code: 'invalid_phone' });
    expect(reasonView('odd')).toEqual({ known: false, raw: 'odd' });
    expect(reasonView(null)).toBeNull();
    expect(reasonView('')).toBeNull();
  });
});

describe('filters', () => {
  it('asks the API for no status on "all" and for the status otherwise', () => {
    expect(statusOfFilter('all')).toBeUndefined();
    expect(statusOfFilter('needs_review')).toBe('needs_review');
    expect(statusOfFilter('failed')).toBe('failed');
  });
});
