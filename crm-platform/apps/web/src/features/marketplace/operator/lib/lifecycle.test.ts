import { describe, expect, it } from 'vitest';
import {
  MARKET_APP_STATUSES,
  MARKET_VERSION_STATUSES,
  type MarketAppStatus,
  type MarketVersionStatus,
} from '@crm/contracts';
import {
  APP_ACTIONS,
  VERSION_ACTIONS,
  appActionAllowed,
  appActions,
  lackedPermissions,
  versionActionAllowed,
  versionActions,
  versionActionsByState,
  type AppAction,
  type VersionAction,
} from './lifecycle';
import { marketAccess } from './permissions';

const MANAGE = marketAccess({ 'platform.market.manage': true });
const REVIEW = marketAccess({ 'platform.market.review': true });
const BOTH = marketAccess({ 'platform.market.manage': true, 'platform.market.review': true });
const NONE = marketAccess({});

const facts = (
  status: MarketAppStatus,
  over: Partial<{
    publishedVersion: string | null;
    publishedAt: string | null;
    installCount: number;
  }> = {},
) => ({
  status,
  publishedVersion:
    status === 'published' || status === 'hidden' || status === 'killed' ? '1.0.0' : null,
  publishedAt:
    status === 'published' || status === 'hidden' || status === 'killed'
      ? '2026-10-01T00:00:00.000Z'
      : null,
  installCount: 0,
  ...over,
});

describe('app lifecycle table', () => {
  const expected: Record<MarketAppStatus, AppAction[]> = {
    draft: ['editListing', 'newVersion', 'kill', 'delete'],
    in_review: ['editListing', 'newVersion', 'kill', 'delete'],
    published: ['editListing', 'newVersion', 'hide', 'kill'],
    hidden: ['editListing', 'newVersion', 'unhide', 'kill'],
    killed: ['editListing', 'newVersion', 'unkill'],
  };

  for (const status of MARKET_APP_STATUSES) {
    it(`${status}: state allows exactly ${expected[status].join(', ')}`, () => {
      const allowed = APP_ACTIONS.filter((a) => appActionAllowed(facts(status), a));
      expect(allowed).toEqual(APP_ACTIONS.filter((a) => expected[status].includes(a)));
    });
  }

  it('delete needs a listing that was never published and never installed', () => {
    expect(appActionAllowed(facts('draft', { installCount: 1 }), 'delete')).toBe(false);
    expect(appActionAllowed(facts('draft', { publishedVersion: '0.1.0' }), 'delete')).toBe(false);
    expect(
      appActionAllowed(facts('in_review', { publishedAt: '2026-10-01T00:00:00.000Z' }), 'delete'),
    ).toBe(false);
    expect(appActionAllowed(facts('in_review'), 'delete')).toBe(true);
  });

  it('a hidden listing that was never published has nothing to show again', () => {
    expect(appActionAllowed(facts('hidden', { publishedVersion: null }), 'unhide')).toBe(false);
  });

  it('every app action needs the manage key: review alone offers none, manage offers all the state allows', () => {
    for (const status of MARKET_APP_STATUSES) {
      expect(appActions(facts(status), REVIEW)).toEqual([]);
      expect(appActions(facts(status), NONE)).toEqual([]);
      expect(appActions(facts(status), MANAGE)).toEqual(appActions(facts(status), BOTH));
      expect(appActions(facts(status), MANAGE)).toEqual(
        APP_ACTIONS.filter((a) => expected[status].includes(a)),
      );
    }
  });
});

describe('version lifecycle table', () => {
  const expected: Record<VersionAction, MarketVersionStatus[]> = {
    edit: ['draft', 'rejected'],
    submit: ['draft', 'rejected'],
    approve: ['draft', 'in_review'],
    reject: ['draft', 'in_review'],
    publish: ['approved'],
  };

  for (const action of VERSION_ACTIONS) {
    it(`${action} is allowed from ${expected[action].join(', ')} only`, () => {
      for (const status of MARKET_VERSION_STATUSES) {
        expect(versionActionAllowed(status, action), `${action} from ${status}`).toBe(
          expected[action].includes(status),
        );
      }
    });
  }

  it('a published or retired version has no version action at all', () => {
    for (const status of ['published', 'retired'] as const) {
      for (const a of VERSION_ACTIONS) expect(versionActionAllowed(status, a)).toBe(false);
    }
  });

  const manageActions: VersionAction[] = ['edit', 'submit'];
  const reviewActions: VersionAction[] = ['approve', 'reject', 'publish'];

  for (const status of MARKET_VERSION_STATUSES) {
    it(`${status}: manage offers the manage actions, review the review ones, both the union`, () => {
      const app = { status: 'in_review' as const };
      const v = { status };
      const byState = versionActionsByState(v, app);
      expect(versionActions(v, app, MANAGE)).toEqual(
        byState.filter((a) => manageActions.includes(a)),
      );
      expect(versionActions(v, app, REVIEW)).toEqual(
        byState.filter((a) => reviewActions.includes(a)),
      );
      expect(versionActions(v, app, BOTH)).toEqual(byState);
      expect(versionActions(v, app, NONE)).toEqual([]);
    });
  }

  it('a review-only operator sees approve and reject on a version in review, and no edit or submit', () => {
    expect(versionActions({ status: 'in_review' }, { status: 'in_review' }, REVIEW)).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('a manage-only operator sees edit and submit on a rejected version, and no approve or publish', () => {
    expect(versionActions({ status: 'rejected' }, { status: 'draft' }, MANAGE)).toEqual([
      'edit',
      'submit',
    ]);
  });

  it('publish is offered for an approved version only, and never on a killed listing', () => {
    expect(versionActions({ status: 'approved' }, { status: 'hidden' }, REVIEW)).toEqual([
      'publish',
    ]);
    expect(versionActions({ status: 'approved' }, { status: 'killed' }, REVIEW)).toEqual([]);
    expect(versionActions({ status: 'approved' }, { status: 'killed' }, BOTH)).toEqual([]);
  });
});

describe('lackedPermissions', () => {
  it('names the key behind actions the state allows but the caller cannot use', () => {
    const app = facts('published');
    expect(lackedPermissions(app, { status: 'approved' }, REVIEW)).toEqual(['manage']);
    expect(lackedPermissions(app, { status: 'approved' }, MANAGE)).toEqual(['review']);
    expect(lackedPermissions(app, { status: 'approved' }, BOTH)).toEqual([]);
  });

  it('does not nag about a key no allowed action needs', () => {
    // A retired version has no version action, so a manage-only operator lacks nothing on it.
    expect(lackedPermissions(facts('published'), { status: 'retired' }, MANAGE)).toEqual([]);
  });
});
