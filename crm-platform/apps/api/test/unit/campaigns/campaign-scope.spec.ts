import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  campaignCreatorLimit,
  campaignScopeSql,
} from '../../../src/modules/campaigns/campaign-scope';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';

type Grants = NonNullable<RequestContext['grants']>;

function as<T>(grants: Grants | undefined, fn: () => T): T {
  return RequestContextStore.run(
    { requestId: 'r', orgId: 1, actorType: 'user', actorId: 7, userId: 7, grants },
    fn,
  );
}

const grant = (scope: 'all' | 'own' | 'team', effect: 'allow' | 'deny' = 'allow'): Grants =>
  new Map([['camp.campaigns.read', { effect, scope }]]);

const render = (
  key: Parameters<typeof campaignScopeSql>[0],
  alias: string | null,
  column?: 'user_id',
) => {
  const q = new PgDialect().sqlToQuery(campaignScopeSql(key, alias, column));
  return { text: q.sql.trim(), params: q.params };
};

describe('campaign record scope', () => {
  it('does not narrow a global grant, nor a caller without grants (a worker)', () => {
    expect(as(grant('all'), () => campaignCreatorLimit('camp.campaigns.read'))).toBeNull();
    expect(as(undefined, () => campaignCreatorLimit('camp.campaigns.read'))).toBeNull();
    expect(as(grant('all'), () => render('camp.campaigns.read', 'c').text)).toBe('');
  });

  it('limits a restricted grant to the records the user created', () => {
    expect(as(grant('own'), () => campaignCreatorLimit('camp.campaigns.read'))).toBe(7);
    expect(as(grant('own'), () => render('camp.campaigns.read', 'c'))).toEqual({
      text: 'AND c.created_by = $1',
      params: [7],
    });
  });

  it('reads a team scope as restricted, since a campaign has no team', () => {
    expect(as(grant('team'), () => campaignCreatorLimit('camp.campaigns.read'))).toBe(7);
  });

  it('names the creator column of the legacy broadcasts and works without an alias', () => {
    expect(as(grant('own'), () => render('camp.campaigns.read', 'b', 'user_id').text)).toBe(
      'AND b.user_id = $1',
    );
    expect(as(grant('own'), () => render('camp.campaigns.read', null).text)).toBe(
      'AND created_by = $1',
    );
  });

  it('matches nothing for a restricted caller that is not a staff user', () => {
    const ctx = {
      requestId: 'r',
      orgId: 1,
      actorType: 'api_key',
      actorId: null,
      userId: null,
      grants: grant('own'),
    } as unknown as RequestContext;
    expect(RequestContextStore.run(ctx, () => campaignCreatorLimit('camp.campaigns.read'))).toBe(
      -1,
    );
  });
});
