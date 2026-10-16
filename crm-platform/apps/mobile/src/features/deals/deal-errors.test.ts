import { initI18n, i18n } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import {
  describeDealFailure,
  describeDealFormFailure,
  isConflict,
  isLostReasonRequired,
  isNotFound,
  isPlanLocked,
} from './deal-errors';

beforeAll(async () => {
  await initI18n('en');
});

const t = i18n.t.bind(i18n);
const refused = (
  status: number,
  code: string,
  fields: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'x', undefined, fields);

describe('the checks', () => {
  it('recognise a failure by its code, never by its text', () => {
    expect(isPlanLocked(refused(422, 'PLAN_FEATURE_LOCKED'))).toBe(true);
    expect(isNotFound(refused(404, 'NOT_FOUND'))).toBe(true);
    expect(isConflict(refused(409, 'ROW_VERSION_CONFLICT'))).toBe(true);
    expect(isLostReasonRequired(refused(422, 'DEAL_LOST_REASON_REQUIRED'))).toBe(true);
    expect(isPlanLocked(new Error('PLAN_FEATURE_LOCKED'))).toBe(false);
    expect(isConflict(refused(409, 'SOMETHING_ELSE'))).toBe(false);
  });
});

describe('describeDealFailure', () => {
  it.each([
    [
      'ROW_VERSION_CONFLICT',
      409,
      'This deal was changed by someone else. Look at it again and try once more.',
    ],
    ['NOT_FOUND', 404, 'This deal no longer exists.'],
    ['DEAL_TASK_NOT_FOUND', 404, 'This deal no longer exists.'],
    ['PLAN_FEATURE_LOCKED', 422, 'Deals are not included in this plan.'],
    ['FORBIDDEN', 403, "You don't have permission to do that."],
    ['DEAL_LOST_REASON_REQUIRED', 422, 'Choose or write a reason for losing this deal.'],
    ['DEAL_OWNER_INVALID', 422, "That person can't own this deal."],
    ['DEAL_STAGE_MISMATCH', 422, "That stage doesn't belong to this pipeline."],
    ['DEAL_NO_WON_STAGE', 422, 'This pipeline has no Won stage.'],
    ['DEAL_NO_LOST_STAGE', 422, 'This pipeline has no Lost stage.'],
    ['DEAL_NO_OPEN_STAGE', 422, 'This pipeline has no open stage to reopen into.'],
  ])('says it in words for %s', (code, status, text) => {
    expect(describeDealFailure(refused(status, code), t)).toBe(text);
  });

  it('falls back to the app-wide message for a code it has no sentence for, and for a plain failure', () => {
    expect(describeDealFailure(refused(500, 'INTERNAL'), t)).toBe(t('errors.generic'));
    expect(describeDealFailure(new ApiError(0, 'CLIENT_NETWORK', 'offline'), t)).toBe(
      t('errors.network'),
    );
    expect(describeDealFailure(new Error('boom'), t)).toBe(t('errors.generic'));
  });
});

describe('describeDealFormFailure', () => {
  it('reports a stale version as a conflict, not as a message', () => {
    expect(describeDealFormFailure(refused(409, 'ROW_VERSION_CONFLICT'), t)).toEqual({
      banner: null,
      fields: {},
      conflict: true,
    });
  });

  it('puts what the server says under the field it names', () => {
    const result = describeDealFormFailure(
      refused(422, 'VALIDATION_FAILED', [
        { path: 'title', message: 'required' },
        { path: 'value', message: 'bad' },
        { path: 'expectedCloseDate', message: 'bad' },
      ]),
      t,
    );
    expect(result.banner).toBeNull();
    expect(result.fields).toEqual({
      title: 'Enter a name for the deal.',
      value: 'Enter an amount like 1250.50, with no more decimals than the currency has.',
      close: 'Enter a real day like 2026-10-31.',
    });
    expect(result.conflict).toBe(false);
  });

  it('says it about the whole form when no field is named', () => {
    expect(describeDealFormFailure(refused(422, 'DEAL_OWNER_INVALID'), t)).toEqual({
      banner: "That person can't own this deal.",
      fields: {},
      conflict: false,
    });
  });
});
