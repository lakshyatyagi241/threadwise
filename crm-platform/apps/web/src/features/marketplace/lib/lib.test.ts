import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MARKET_HEALTH_STATES,
  MARKET_INSTALL_STATUSES,
  type MarketHealth,
  type MarketInstallStatus,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { ID, SECRET, card, installation, request, scopes } from '../test-fixtures';
import {
  BROWSE_TABS,
  NO_FILTERS,
  browseHref,
  categoryItems,
  emptyReason,
  hasActiveFilter,
  kindForSegment,
  knownCategory,
  listQuery,
  parseBrowseParams,
  showShelves,
} from './browse';
import {
  acceptedScopesFor,
  consentDiff,
  consentMatches,
  installerGaps,
  normalizeScopes,
  overallRisk,
  parseConsentProblems,
  riskCounts,
  scopeChanges,
  sortByRisk,
} from './consent';
import { MKT_ERROR_KINDS, isPlanGate, isRetryable, mktError, retryAfterSeconds } from './errors';
import {
  cardCta,
  effectiveLock,
  healthChip,
  installChips,
  installGate,
  installationChips,
  lockView,
  statusChip,
} from './install-state';
import { DEFAULT_DATA_CHOICE, manageView, uninstallBody, usageView } from './manage';
import { MARKET_PERMISSIONS, missingKey } from './permissions';
import {
  askOutcome,
  emptyRequestDraft,
  replaceRequest,
  toRequestBody,
  validateRequest,
  withVote,
} from './requests';
import { mktRoutes, safeInternalPath } from './routes';
import {
  canDismiss,
  dismiss,
  isBlocking,
  reveal,
  setSaved,
  startReveal,
  visiblePayload,
  type RevealPayload,
} from './secret-reveal';
import {
  buildCredentialPatch,
  buildInstallCredentials,
  canClear,
  credentialDisplay,
  initialValues,
  parseEndsIn,
  validateFields,
  type SetupField,
} from './setup-form';
import { initialsOf, isHttpsLink, paragraphs } from './text';

const problem = (
  status: number,
  code: string,
  errors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that must never be branched on', 'req-1', errors);

// --- consent ---------------------------------------------------------------------------------------------------------------------

describe('consent matching', () => {
  it('matches equal sets, whatever the order and however often an id repeats', () => {
    expect(consentMatches(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(consentMatches(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(consentMatches(['a', 'b'], ['b', 'a', 'a', 'b'])).toBe(true);
    expect(consentMatches([], [])).toBe(true);
  });

  it('refuses a missing scope and an unexpected one, and reports each', () => {
    expect(consentMatches(['a', 'b'], ['a'])).toBe(false);
    expect(consentMatches(['a'], ['a', 'z'])).toBe(false);
    expect(consentDiff(['a', 'b'], ['a'])).toEqual({ missing: ['b'], unexpected: [] });
    expect(consentDiff(['a'], ['a', 'z'])).toEqual({ missing: [], unexpected: ['z'] });
    expect(consentDiff(['a', 'b'], ['b', 'z'])).toEqual({ missing: ['a'], unexpected: ['z'] });
  });

  it('sends exactly the ids that were shown: unique and sorted', () => {
    const shown = scopes('messages.send', 'contacts.read', 'leads.write');
    expect(acceptedScopesFor(shown)).toEqual(['contacts.read', 'leads.write', 'messages.send']);
    expect(
      consentMatches(
        shown.map((s) => s.id),
        acceptedScopesFor(shown),
      ),
    ).toBe(true);
    expect(normalizeScopes(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(acceptedScopesFor([])).toEqual([]);
  });

  it('reads missing: and unexpected: from a MKT_CONSENT_REQUIRED answer, and ignores anything else', () => {
    expect(
      parseConsentProblems([
        { path: 'acceptedScopes', message: 'missing:leads.write' },
        { path: 'acceptedScopes', message: 'unexpected:messages.send' },
        { path: 'acceptedScopes', message: 'missing:contacts.read' },
        { path: 'acceptedScopes', message: 'must_equal_pending_scopes' },
      ]),
    ).toEqual({ missing: ['contacts.read', 'leads.write'], unexpected: ['messages.send'] });
    expect(parseConsentProblems([])).toEqual({ missing: [], unexpected: [] });
  });

  it('finds what changed between the list that was shown and the current one', () => {
    const before = scopes('contacts.read', 'leads.write');
    const same = scopeChanges(before, scopes('leads.write', 'contacts.read'));
    expect(same.changed).toBe(false);

    const grew = scopeChanges(before, scopes('contacts.read', 'leads.write', 'messages.send'));
    expect(grew.added.map((s) => s.id)).toEqual(['messages.send']);
    expect(grew.removedIds).toEqual([]);
    expect(grew.changed).toBe(true);

    const shrank = scopeChanges(before, scopes('contacts.read'));
    expect(shrank.removedIds).toEqual(['leads.write']);
    expect(shrank.added).toEqual([]);

    const reworded = scopeChanges(before, [{ ...before[0]!, risk: 'high' }, before[1]!]);
    expect(reworded.changedIds).toEqual(['contacts.read']);
    expect(reworded.changed).toBe(true);
  });

  it('orders by risk, riskiest first, and summarises the whole list', () => {
    const list = scopes('contacts.read', 'messages.send', 'leads.write');
    expect(sortByRisk(list).map((s) => s.risk)).toEqual(['high', 'medium', 'low']);
    expect(overallRisk(list)).toBe('high');
    expect(overallRisk(scopes('contacts.read'))).toBe('low');
    expect(overallRisk([])).toBe('low');
    expect(riskCounts(list)).toEqual({ low: 1, medium: 1, high: 1 });
  });

  it('warns about permission keys the person lacks, from the session map', () => {
    expect(installerGaps(['contacts.read'], { 'record.contacts.read': 'all' })).toEqual([]);
    expect(
      installerGaps(['contacts.read', 'messages.send'], { 'record.contacts.read': 'all' }),
    ).toEqual(['inbox.conversation.reply']);
  });
});

// --- secret reveal ---------------------------------------------------------------------------------------------------------------

describe('secret reveal state machine', () => {
  const payload: RevealPayload = {
    secret: SECRET,
    url: 'https://x.test/hook',
    tokenHeader: 'X-T',
    signatureHeader: 'X-S',
    auth: 'either',
  };

  it('has nothing to show when no secret came with the answer', () => {
    expect(startReveal(null)).toEqual({ phase: 'none' });
    expect(startReveal({ ...payload, secret: '' })).toEqual({ phase: 'none' });
    expect(isBlocking(startReveal(null))).toBe(false);
  });

  it('shows the secret once, and leaving needs the confirmation first', () => {
    let s = startReveal(payload);
    expect(s.phase).toBe('shown');
    expect(visiblePayload(s)?.secret).toBe(SECRET);
    expect(isBlocking(s)).toBe(true);
    expect(canDismiss(s)).toBe(false);
    expect(dismiss(s)).toEqual(s); // refused: not confirmed yet
    s = setSaved(s, true);
    expect(canDismiss(s)).toBe(true);
    s = dismiss(s);
    expect(s).toEqual({ phase: 'dismissed' });
    expect(visiblePayload(s)).toBeNull();
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });

  it('can un-tick the confirmation before leaving', () => {
    let s = setSaved(startReveal(payload), true);
    s = setSaved(s, false);
    expect(canDismiss(s)).toBe(false);
  });

  it('is never re-enterable: a dismissed or shown reveal ignores a second secret', () => {
    const dismissed = dismiss(setSaved(startReveal(payload), true));
    expect(reveal(dismissed, payload)).toEqual({ phase: 'dismissed' });
    const shown = startReveal(payload);
    expect(reveal(shown, { ...payload, secret: 'other' })).toBe(shown);
  });

  it('only a none state can start showing', () => {
    expect(reveal({ phase: 'none' }, payload).phase).toBe('shown');
    expect(reveal({ phase: 'none' }, { ...payload, secret: '' })).toEqual({ phase: 'none' });
    expect(setSaved({ phase: 'none' }, true)).toEqual({ phase: 'none' });
    expect(dismiss({ phase: 'none' })).toEqual({ phase: 'none' });
  });
});

// --- chips and calls to action ---------------------------------------------------------------------------------------------------

describe('install state chips', () => {
  it('maps every status and health to a chip with a tone', () => {
    expect(MARKET_INSTALL_STATUSES.map((s) => statusChip(s))).toEqual([
      { key: 'installed', tone: 'success' },
      { key: 'paused', tone: 'warning' },
      { key: 'killed', tone: 'danger' },
    ]);
    expect(MARKET_HEALTH_STATES.map((h) => healthChip(h).key)).toEqual([
      'unknown',
      'healthy',
      'degraded',
      'error',
      'needs_reauth',
    ]);
    expect(healthChip('degraded').tone).toBe('warning');
    expect(healthChip('error').tone).toBe('danger');
    expect(healthChip('needs_reauth').tone).toBe('danger');
    expect(healthChip('unknown').tone).toBe('neutral');
  });

  it('draws the right chips for every status x health x needs-consent combination', () => {
    for (const status of MARKET_INSTALL_STATUSES) {
      for (const health of MARKET_HEALTH_STATES) {
        for (const needsReconsent of [false, true]) {
          const keys = installChips({ status, health, needsReconsent }).map((c) => c.key);
          const label = `${status}/${health}/${needsReconsent}`;
          if (status === 'killed') {
            expect(keys, label).toEqual(['killed']);
            continue;
          }
          const expected: string[] = [status === 'active' ? 'installed' : 'paused'];
          if (status === 'active' && health !== 'unknown') expected.push(health);
          if (needsReconsent) expected.push('needsConsent');
          expect(keys, label).toEqual(expected);
        }
      }
    }
  });

  it('shows an unknown health on the manage page only', () => {
    const base = {
      status: 'active' as MarketInstallStatus,
      health: 'unknown' as MarketHealth,
      needsReconsent: false,
    };
    expect(installChips(base).map((c) => c.key)).toEqual(['installed']);
    expect(installChips(base, { showUnknown: true }).map((c) => c.key)).toEqual([
      'installed',
      'unknown',
    ]);
    expect(
      installationChips(
        installation({
          health: { status: 'error', checkedAt: null, lastError: 'x', lastErrorAt: null },
        }),
      ).map((c) => c.key),
    ).toEqual(['installed', 'error']);
  });
});

describe('lock and call to action', () => {
  it('words each lock reason and only offers an upgrade where it can help', () => {
    expect(lockView(null)).toBeNull();
    expect(
      lockView({ reason: 'plan_feature', key: 'analytics', upgradeUrl: '/account/plans' }),
    ).toEqual({
      reason: 'plan_feature',
      key: 'planFeature',
      subject: 'analytics',
      upgradeHref: '/account/plans',
    });
    expect(lockView({ reason: 'limit_reached', key: null, upgradeUrl: null })?.upgradeHref).toBe(
      '/account/plans',
    );
    expect(
      lockView({ reason: 'module_disabled', key: 'x', upgradeUrl: null })?.upgradeHref,
    ).toBeNull();
  });

  it('follows only same-site upgrade links', () => {
    expect(safeInternalPath('/account/plans?x=1')).toBe('/account/plans?x=1');
    expect(safeInternalPath('https://evil.test')).toBe('/account/plans');
    expect(safeInternalPath('//evil.test')).toBe('/account/plans');
    expect(safeInternalPath('javascript:alert(1)')).toBe('/account/plans');
    expect(safeInternalPath('/a b')).toBe('/account/plans');
    expect(safeInternalPath(null)).toBe('/account/plans');
  });

  it('never locks an installed app, whatever the response says', () => {
    const locked = { reason: 'plan_feature' as const, key: 'k', upgradeUrl: null };
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    expect(effectiveLock(card({ locked }))?.key).toBe('planFeature');
    expect(effectiveLock(card({ locked, install }))).toBeNull();
  });

  it('chooses the card button for every state', () => {
    const can = { install: true };
    const install = (over: object) => ({
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
      ...over,
    });
    expect(cardCta(card(), can)).toEqual({
      kind: 'install',
      href: '/marketplace/app/webhook/install',
      upgradeHref: null,
    });
    expect(cardCta(card(), { install: false })).toMatchObject({
      kind: 'view',
      href: '/marketplace/app/webhook',
    });
    expect(cardCta(card({ install: install({}) }), can)).toMatchObject({
      kind: 'manage',
      href: `/marketplace/installed/${ID(50)}`,
    });
    expect(cardCta(card({ install: install({ needsReconsent: true }) }), can).kind).toBe('review');
    expect(cardCta(card({ install: install({ status: 'killed' }) }), can).kind).toBe('killed');
    expect(cardCta(card({ install: install({ status: 'disabled' }) }), can).kind).toBe('manage');
    const locked = cardCta(
      card({ locked: { reason: 'plan_feature', key: 'k', upgradeUrl: '/account/plans' } }),
      can,
    );
    expect(locked).toEqual({
      kind: 'locked',
      href: '/marketplace/app/webhook',
      upgradeHref: '/account/plans',
    });
    // A lock beats the permission: the person sees why it is locked rather than a button they cannot use.
    expect(
      cardCta(card({ locked: { reason: 'limit_reached', key: null, upgradeUrl: null } }), {
        install: false,
      }).kind,
    ).toBe('locked');
  });

  it('gates the install button of the app page', () => {
    expect(installGate(card(), { install: true })).toEqual({
      kind: 'allowed',
      href: '/marketplace/app/webhook/install',
    });
    expect(installGate(card(), { install: false })).toEqual({
      kind: 'noPermission',
      permission: 'market.apps.install',
    });
    expect(
      installGate(card({ locked: { reason: 'plan_feature', key: 'k', upgradeUrl: null } }), {
        install: true,
      }).kind,
    ).toBe('locked');
    const inst = {
      installationId: ID(50),
      status: 'killed' as const,
      health: 'unknown' as const,
      needsReconsent: false,
    };
    expect(installGate(card({ install: inst }), { install: true }).kind).toBe('killed');
    expect(
      installGate(card({ install: { ...inst, status: 'active' } }), { install: false }).kind,
    ).toBe('installed');
  });
});

// --- errors ----------------------------------------------------------------------------------------------------------------------

describe('error mapping', () => {
  const kind = (e: unknown) => mktError(e).kind;

  it('maps every code the screens branch on', () => {
    expect(kind(new Error('x'))).toBe('network');
    expect(kind(problem(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(kind(problem(401, ERROR_CODES.UNAUTHENTICATED))).toBe('signedOut');
    expect(kind(problem(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe('conflict');
    expect(kind(problem(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
    expect(kind(problem(429, ERROR_CODES.RATE_LIMITED))).toBe('rateLimited');
    expect(kind(problem(404, ERROR_CODES.NOT_FOUND))).toBe('notFound');
    expect(kind(problem(404, ERROR_CODES.MKT_APP_NOT_FOUND))).toBe('appNotFound');
    expect(kind(problem(404, ERROR_CODES.MKT_NOT_INSTALLED))).toBe('notInstalled');
    expect(kind(problem(409, ERROR_CODES.MKT_ALREADY_INSTALLED))).toBe('alreadyInstalled');
    expect(kind(problem(409, ERROR_CODES.MKT_APP_UNAVAILABLE))).toBe('appUnavailable');
    expect(kind(problem(422, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('planLocked');
    expect(kind(problem(422, ERROR_CODES.MKT_CONSENT_REQUIRED))).toBe('consentRequired');
    expect(kind(problem(422, ERROR_CODES.MKT_RECONSENT_REQUIRED))).toBe('reconsentRequired');
    expect(kind(problem(403, ERROR_CODES.MKT_SCOPE_EXCEEDS_INSTALLER))).toBe('scopeExceeds');
    expect(kind(problem(409, ERROR_CODES.MKT_INSTALLATION_KILLED))).toBe('installationKilled');
    expect(kind(problem(409, ERROR_CODES.MKT_INSTALLATION_DISABLED))).toBe('installationDisabled');
    expect(kind(problem(422, ERROR_CODES.MKT_CREDENTIAL_MISSING))).toBe('credentialMissing');
    expect(kind(problem(409, ERROR_CODES.MKT_NO_CONNECTION))).toBe('noConnection');
    expect(kind(problem(503, ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE))).toBe('leadPipeline');
    expect(kind(problem(500, ERROR_CODES.INTERNAL))).toBe('unexpected');
    expect(kind(problem(404, 'UNKNOWN'))).toBe('unavailable');
    expect(kind(problem(501, 'UNKNOWN'))).toBe('unavailable');
  });

  it('tells a plan-feature lock from a missing module by its reason, not its wording', () => {
    expect(
      kind(problem(422, ERROR_CODES.MKT_APP_LOCKED, [{ path: 'reason', message: 'plan_feature' }])),
    ).toBe('appLockedPlan');
    expect(
      kind(
        problem(422, ERROR_CODES.MKT_APP_LOCKED, [{ path: 'reason', message: 'module_disabled' }]),
      ),
    ).toBe('appLockedModule');
    expect(
      mktError(
        problem(422, ERROR_CODES.MKT_APP_LOCKED, [
          { path: 'reason', message: 'plan_feature' },
          { path: 'upgradeUrl', message: '/account/plans' },
        ]),
      ).upgradeHref,
    ).toBe('/account/plans');
    expect(
      mktError(
        problem(422, ERROR_CODES.MKT_APP_LOCKED, [{ path: 'reason', message: 'module_disabled' }]),
      ).upgradeHref,
    ).toBeNull();
  });

  it('carries the feature lock details and refuses an upgrade link that leaves the site', () => {
    const e = mktError(
      problem(422, ERROR_CODES.PLAN_FEATURE_LOCKED, [
        { path: 'feature', message: 'marketplace' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]),
    );
    expect(e).toMatchObject({
      kind: 'planLocked',
      upgradeHref: '/account/plans',
      requestId: 'req-1',
    });
    const bad = mktError(
      problem(422, ERROR_CODES.PLAN_FEATURE_LOCKED, [
        { path: 'upgradeUrl', message: 'https://evil.test' },
      ]),
    );
    expect(bad.upgradeHref).toBe('/account/plans');
  });

  it('tells the installed-apps cap from the lead-sources cap, with the counts when they came', () => {
    const installed = mktError(
      problem(422, ERROR_CODES.PLAN_LIMIT_REACHED, [
        { path: 'limit', message: 'installed_apps' },
        { path: 'used', message: '5' },
        { path: 'limitValue', message: '5' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]),
    );
    expect(installed.kind).toBe('planLimitInstalled');
    expect(installed.limit).toEqual({ used: 5, cap: 5 });
    expect(isPlanGate(installed)).toBe(true);
    const leads = mktError(
      problem(422, ERROR_CODES.PLAN_LIMIT_REACHED, [{ path: 'limit', message: 'lead_sources' }]),
    );
    expect(leads.kind).toBe('planLimitLeadSources');
    expect(leads.limit).toEqual({ used: null, cap: null });
    expect(kind(problem(422, ERROR_CODES.PLAN_LIMIT_REACHED))).toBe('planLimit');
  });

  it('lists the permission keys MKT_SCOPE_EXCEEDS_INSTALLER says are missing', () => {
    const e = mktError(
      problem(403, ERROR_CODES.MKT_SCOPE_EXCEEDS_INSTALLER, [
        { path: 'permission', message: 'inbox.conversation.reply' },
        { path: 'permission', message: 'admin.apikey.manage' },
      ]),
    );
    expect(e.kind).toBe('scopeExceeds');
    expect(e.missingPermissions).toEqual(['inbox.conversation.reply', 'admin.apikey.manage']);
  });

  it('parses the details of MKT_CONSENT_REQUIRED', () => {
    const e = mktError(
      problem(422, ERROR_CODES.MKT_CONSENT_REQUIRED, [
        { path: 'acceptedScopes', message: 'missing:messages.send' },
        { path: 'acceptedScopes', message: 'unexpected:contacts.read' },
      ]),
    );
    expect(e.consent).toEqual({ missing: ['messages.send'], unexpected: ['contacts.read'] });
    expect(mktError(problem(500, ERROR_CODES.INTERNAL)).consent).toBeNull();
  });

  it('maps credential problems to fields by key', () => {
    const e = mktError(
      problem(422, ERROR_CODES.MKT_CREDENTIAL_MISSING, [
        { path: 'credentials.portalKey', message: 'Required' },
        { path: 'credentials.account', message: 'Does not look right' },
      ]),
    );
    expect(e.fields).toEqual({ portalKey: 'Required', account: 'Does not look right' });
    expect(mktError(problem(404, ERROR_CODES.NOT_FOUND)).fields).toEqual({});
  });

  it('decides what can be retried and reads the wait of a 429', () => {
    expect(isRetryable(mktError(new Error('x')))).toBe(true);
    expect(isRetryable(mktError(problem(503, ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE)))).toBe(
      true,
    );
    expect(isRetryable(mktError(problem(409, ERROR_CODES.ROW_VERSION_CONFLICT)))).toBe(false);
    expect(
      retryAfterSeconds(
        problem(429, ERROR_CODES.RATE_LIMITED, [{ path: 'retryAfterSeconds', message: '12' }]),
      ),
    ).toBe(12);
    expect(retryAfterSeconds(problem(429, ERROR_CODES.RATE_LIMITED))).toBeNull();
  });

  it('has a kind list the messages test can check', () => {
    expect(new Set(MKT_ERROR_KINDS).size).toBe(MKT_ERROR_KINDS.length);
  });
});

// --- browse ----------------------------------------------------------------------------------------------------------------------

describe('browse view model', () => {
  it('has the two tabs, by route segment', () => {
    expect(BROWSE_TABS.map((t) => [t.kind, t.href])).toEqual([
      ['mini_app', '/marketplace/apps'],
      ['integration', '/marketplace/integrations'],
    ]);
    expect(kindForSegment('apps')).toBe('mini_app');
    expect(kindForSegment('integrations')).toBe('integration');
    expect(kindForSegment('installed')).toBeNull();
  });

  it('reads filters from the address and drops what the API would refuse', () => {
    const p = (s: string) => parseBrowseParams(new URLSearchParams(s));
    expect(p('')).toEqual(NO_FILTERS);
    expect(p('category=lead-sources&q=%20just%20&installed=true&sort=popular')).toEqual({
      category: 'lead-sources',
      q: 'just',
      installed: true,
      sort: 'popular',
    });
    expect(p('category=Bad Slug&sort=bogus&installed=yes')).toEqual(NO_FILTERS);
    expect(p(`q=${'x'.repeat(200)}`).q).toHaveLength(80);
  });

  it('writes the address back without defaults', () => {
    expect(browseHref('integration')).toBe('/marketplace/integrations');
    expect(
      browseHref('mini_app', { category: 'sales', q: ' crm ', installed: true, sort: 'name' }),
    ).toBe('/marketplace/apps?category=sales&q=crm&installed=true&sort=name');
    expect(browseHref('mini_app', { sort: 'featured', q: '' })).toBe('/marketplace/apps');
  });

  it('shows shelves only while nothing narrows the list', () => {
    expect(showShelves(NO_FILTERS)).toBe(true);
    expect(showShelves({ ...NO_FILTERS, sort: 'name' })).toBe(true);
    expect(showShelves({ ...NO_FILTERS, q: 'a' })).toBe(false);
    expect(showShelves({ ...NO_FILTERS, category: 'sales' })).toBe(false);
    expect(showShelves({ ...NO_FILTERS, installed: true })).toBe(false);
    expect(hasActiveFilter(NO_FILTERS)).toBe(false);
  });

  it('builds the list query', () => {
    expect(
      listQuery('integration', { ...NO_FILTERS, category: 'sales', q: 'x', installed: true }),
    ).toEqual({
      kind: 'integration',
      category: 'sales',
      q: 'x',
      installed: true,
      sort: 'featured',
      limit: 24,
    });
    expect(listQuery('mini_app', NO_FILTERS)).toMatchObject({
      category: undefined,
      q: undefined,
      installed: undefined,
    });
  });

  it('builds the category list: All first with the sum, the selection, links that keep the other filters', () => {
    const cats = [
      { slug: 'b', name: 'Beta', appCount: 2, sortOrder: 2 },
      { slug: 'a', name: 'Alpha', appCount: 3, sortOrder: 1 },
    ];
    const items = categoryItems('integration', cats, { ...NO_FILTERS, category: 'a', q: 'zap' });
    expect(items.map((i) => [i.slug, i.count, i.selected])).toEqual([
      [null, 5, false],
      ['a', 3, true],
      ['b', 2, false],
    ]);
    expect(items[0]!.href).toBe('/marketplace/integrations?q=zap');
    expect(items[2]!.href).toBe('/marketplace/integrations?category=b&q=zap');
    expect(categoryItems('mini_app', cats, NO_FILTERS)[0]!.selected).toBe(true);
    expect(knownCategory(cats, 'a')).toBe(true);
    expect(knownCategory(cats, 'zzz')).toBe(false);
    expect(knownCategory(cats, null)).toBe(true);
  });

  it('chooses the empty state', () => {
    expect(emptyReason({ ...NO_FILTERS, q: 'x', installed: true })).toBe('search');
    expect(emptyReason({ ...NO_FILTERS, installed: true, category: 'a' })).toBe('installed');
    expect(emptyReason({ ...NO_FILTERS, category: 'a' })).toBe('category');
    expect(emptyReason(NO_FILTERS)).toBe('none');
  });
});

// --- setup form ------------------------------------------------------------------------------------------------------------------

const FIELDS: SetupField[] = [
  {
    key: 'portalKey',
    label: 'Portal key',
    kind: 'secret',
    required: true,
    help: null,
    placeholder: null,
    options: null,
    pattern: '^[a-z0-9]{8}$',
  },
  {
    key: 'account',
    label: 'Account id',
    kind: 'text',
    required: false,
    help: null,
    placeholder: null,
    options: null,
  },
  {
    key: 'region',
    label: 'Region',
    kind: 'select',
    required: true,
    help: null,
    placeholder: null,
    options: [
      { value: 'in', label: 'India' },
      { value: 'us', label: 'US' },
    ],
  },
];

describe('setup form', () => {
  it('requires required fields and checks pattern and options on install', () => {
    const empty = initialValues(FIELDS);
    expect(validateFields(FIELDS, empty, { mode: 'install' })).toEqual({
      portalKey: 'required',
      region: 'required',
    });
    expect(
      validateFields(FIELDS, { ...empty, portalKey: 'BAD', region: 'xx' }, { mode: 'install' }),
    ).toEqual({
      portalKey: 'pattern',
      region: 'option',
    });
    expect(
      validateFields(
        FIELDS,
        { portalKey: 'abcd1234', account: '', region: 'in' },
        { mode: 'install' },
      ),
    ).toEqual({});
    expect(
      validateFields(FIELDS, { portalKey: '   ', account: '', region: 'in' }, { mode: 'install' }),
    ).toEqual({
      portalKey: 'required',
    });
  });

  it('ignores a pattern it cannot read instead of blocking the form', () => {
    const odd: SetupField[] = [{ ...FIELDS[0]!, pattern: '(' }];
    expect(validateFields(odd, { portalKey: 'anything' }, { mode: 'install' })).toEqual({});
  });

  it('builds the install credentials from filled fields only, trimmed', () => {
    expect(
      buildInstallCredentials(FIELDS, { portalKey: ' abcd1234 ', account: '', region: 'in' }),
    ).toEqual({
      portalKey: 'abcd1234',
      region: 'in',
    });
  });

  const states = installation().credentials;

  it('on edit a blank secret keeps the stored one, and a plain field starts with its stored text', () => {
    const start = initialValues(FIELDS, states);
    expect(start).toEqual({ portalKey: '', account: 'acct-42', region: '' });
    expect(validateFields(FIELDS.slice(0, 2), start, { mode: 'edit', states })).toEqual({});
    const patch = buildCredentialPatch(FIELDS.slice(0, 2), start, states);
    expect(patch).toEqual({ credentials: {}, clearCredentials: [], empty: true });
  });

  it('on edit typing replaces, and only what changed is sent', () => {
    const f = FIELDS.slice(0, 2);
    expect(
      buildCredentialPatch(f, { portalKey: 'abcd1234', account: 'acct-42' }, states).credentials,
    ).toEqual({ portalKey: 'abcd1234' });
    expect(
      buildCredentialPatch(f, { portalKey: '', account: 'acct-99' }, states).credentials,
    ).toEqual({ account: 'acct-99' });
  });

  it('on edit clearing an optional field sends clearCredentials, and a required one cannot be cleared', () => {
    const f = FIELDS.slice(0, 2);
    expect(canClear(f[1]!, states)).toBe(true);
    expect(canClear(f[0]!, states)).toBe(false);
    expect(canClear(f[1]!, [{ ...states[1]!, isSet: false, hint: null }])).toBe(false);
    const patch = buildCredentialPatch(
      f,
      { portalKey: '', account: 'acct-42' },
      states,
      new Set(['account']),
    );
    expect(patch).toEqual({ credentials: {}, clearCredentials: ['account'], empty: false });
    expect(
      buildCredentialPatch(f, { portalKey: '', account: '' }, states).clearCredentials,
    ).toEqual(['account']);
    expect(
      validateFields(
        f,
        { portalKey: '', account: '' },
        { mode: 'edit', states, cleared: new Set(['portalKey']) },
      ),
    ).toEqual({ portalKey: 'required' });
  });

  it('needs a value for a required secret that was never set', () => {
    const none = [
      { key: 'portalKey', label: 'Portal key', kind: 'secret' as const, isSet: false, hint: null },
    ];
    expect(
      validateFields(FIELDS.slice(0, 1), { portalKey: '' }, { mode: 'edit', states: none }),
    ).toEqual({ portalKey: 'required' });
  });

  it('says what is stored without ever holding a value for a secret', () => {
    expect(credentialDisplay(undefined)).toEqual({ kind: 'notSet' });
    expect(credentialDisplay(states[0])).toEqual({ kind: 'endsIn', last: '9f2a' });
    expect(credentialDisplay(states[1])).toEqual({ kind: 'value', value: 'acct-42' });
    expect(credentialDisplay({ ...states[0]!, hint: null })).toEqual({ kind: 'setNoHint' });
    expect(parseEndsIn('ends in cdef')).toBe('cdef');
    expect(parseEndsIn('something else')).toBeNull();
    expect(parseEndsIn(null)).toBeNull();
  });
});

// --- usage, manage, uninstall ----------------------------------------------------------------------------------------------------

describe('usage view', () => {
  it('says unlimited for limit 0', () => {
    expect(usageView({ installed: 4, limit: 0 })).toMatchObject({
      unlimited: true,
      atCap: false,
      nearCap: false,
      remaining: null,
      tone: 'normal',
    });
  });

  it('counts "x of limit", warns near the cap and prompts at it', () => {
    expect(usageView({ installed: 2, limit: 10 })).toMatchObject({
      unlimited: false,
      remaining: 8,
      tone: 'normal',
    });
    expect(usageView({ installed: 8, limit: 10 })).toMatchObject({
      nearCap: true,
      atCap: false,
      tone: 'near',
      remaining: 2,
    });
    expect(usageView({ installed: 4, limit: 5 })).toMatchObject({ nearCap: true, tone: 'near' });
    expect(usageView({ installed: 3, limit: 5 })).toMatchObject({ nearCap: false, tone: 'normal' });
    expect(usageView({ installed: 10, limit: 10 })).toMatchObject({
      atCap: true,
      nearCap: false,
      tone: 'full',
      remaining: 0,
    });
    expect(usageView({ installed: 12, limit: 10 })).toMatchObject({ atCap: true, remaining: 0 });
    expect(usageView({ installed: 0, limit: 1 })).toMatchObject({ nearCap: true, atCap: false });
  });
});

describe('manage view', () => {
  const all = { read: true, install: true, manage: true };
  const opts = { hasTestPayload: true };

  it('offers everything on a healthy installation to someone who may', () => {
    expect(manageView(installation(), all, opts)).toMatchObject({
      killed: false,
      paused: false,
      canConfigure: true,
      canToggle: true,
      canTest: true,
      canSample: true,
      canRotate: true,
      canUninstall: true,
      onlyUninstall: false,
    });
  });

  it('leaves only uninstall on a killed installation', () => {
    const v = manageView(installation({ status: 'killed', needsReconsent: true }), all, opts);
    expect(v).toMatchObject({
      killed: true,
      onlyUninstall: true,
      canConfigure: false,
      canToggle: false,
      canTest: false,
      canSample: false,
      canRotate: false,
      canAcceptConsent: false,
      needsConsent: false,
      canUninstall: true,
    });
  });

  it('a paused installation can be tested but not sent a sample', () => {
    const v = manageView(installation({ status: 'disabled' }), all, opts);
    expect(v).toMatchObject({ paused: true, canTest: true, canSample: false, canToggle: true });
  });

  it('hides actions by permission and says which is missing', () => {
    const noManage = manageView(installation(), { read: true, install: true, manage: false }, opts);
    expect(noManage).toMatchObject({
      canConfigure: false,
      canToggle: false,
      canTest: false,
      canSample: false,
      canRotate: false,
      canUninstall: true,
    });
    expect(noManage.missing).toEqual({ install: false, manage: true });
    const noInstall = manageView(
      installation({ needsReconsent: true }),
      { read: true, install: false, manage: true },
      opts,
    );
    expect(noInstall).toMatchObject({
      canUninstall: false,
      canAcceptConsent: false,
      needsConsent: true,
      canConfigure: true,
    });
    expect(noInstall.missing.install).toBe(true);
    expect(
      manageView(installation(), { read: true, install: false, manage: false }, opts).missing,
    ).toEqual({ install: true, manage: true });
  });

  it('accepts new permissions only with market.apps.install and a pending version', () => {
    expect(manageView(installation({ needsReconsent: true }), all, opts).canAcceptConsent).toBe(
      true,
    );
    expect(manageView(installation({ needsReconsent: false }), all, opts).canAcceptConsent).toBe(
      false,
    );
  });

  it('needs a connection and a sample payload for the connection actions', () => {
    const none = manageView(installation({ connection: null }), all, opts);
    expect(none).toMatchObject({ canTest: false, canSample: false, canRotate: false });
    expect(manageView(installation(), all, { hasTestPayload: false }).canSample).toBe(false);
  });

  it('keeps the data on uninstall unless told otherwise', () => {
    expect(DEFAULT_DATA_CHOICE).toBe('keep');
    expect(uninstallBody('delete')).toEqual({ dataChoice: 'delete' });
    expect(missingKey({ read: true, install: false, manage: true }, 'install')).toBe(
      MARKET_PERMISSIONS.install,
    );
    expect(missingKey({ read: true, install: true, manage: true }, 'manage')).toBeNull();
  });
});

// --- requests --------------------------------------------------------------------------------------------------------------------

describe('requests', () => {
  it('checks the form with the contract limits', () => {
    const draft = { ...emptyRequestDraft(), name: ' ' };
    expect(validateRequest(draft)).toEqual({ name: 'nameShort' });
    expect(validateRequest({ ...draft, name: 'JustDial' })).toEqual({});
    expect(validateRequest({ ...draft, name: 'x'.repeat(81) })).toEqual({ name: 'nameLong' });
    expect(validateRequest({ ...draft, name: 'ok', website: 'http://x.test' })).toEqual({
      website: 'websiteInvalid',
    });
    expect(validateRequest({ ...draft, name: 'ok', website: 'https://x.test' })).toEqual({});
    expect(validateRequest({ ...draft, name: 'ok', note: 'n'.repeat(501) })).toEqual({
      note: 'noteLong',
    });
  });

  it('sends only what was filled in, with the kind defaulting to integration', () => {
    expect(emptyRequestDraft().kind).toBe('integration');
    expect(toRequestBody({ ...emptyRequestDraft(), name: ' JustDial ' })).toEqual({
      name: 'JustDial',
      kind: 'integration',
    });
    expect(
      toRequestBody({
        name: 'A',
        kind: 'mini_app',
        categorySlug: 'sales',
        website: ' https://a.test ',
        note: ' hi ',
      }),
    ).toEqual({
      name: 'A',
      kind: 'mini_app',
      categorySlug: 'sales',
      website: 'https://a.test',
      note: 'hi',
    });
  });

  it('tells a new request from one that was counted as a vote', () => {
    expect(askOutcome({ created: true })).toBe('created');
    expect(askOutcome({ created: false })).toBe('counted');
  });

  it('applies a vote and takes it back, never below zero', () => {
    const r = request({ voteCount: 7, hasVoted: false });
    expect(withVote(r, true)).toMatchObject({ voteCount: 8, hasVoted: true });
    expect(withVote(withVote(r, true), false)).toMatchObject({ voteCount: 7, hasVoted: false });
    expect(withVote(r, false)).toBe(r);
    expect(withVote(request({ voteCount: 0, hasVoted: true }), false).voteCount).toBe(0);
  });

  it('replaces one request in every page', () => {
    const a = request({ id: ID(1) });
    const b = request({ id: ID(2) });
    const pages = [{ data: [a] }, { data: [b] }];
    const out = replaceRequest(pages, { ...b, voteCount: 99 });
    expect(out[0]!.data[0]).toBe(a);
    expect(out[1]!.data[0]!.voteCount).toBe(99);
  });
});

// --- text and routes -------------------------------------------------------------------------------------------------------------

describe('text helpers', () => {
  it('splits paragraphs on blank lines only', () => {
    expect(paragraphs('One\nstill one\r\n\r\nTwo\n\n\n\nThree')).toEqual([
      'One still one',
      'Two',
      'Three',
    ]);
    expect(paragraphs('')).toEqual([]);
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs('<b>x</b>')).toEqual(['<b>x</b>']);
  });

  it('only treats https addresses without credentials as links', () => {
    expect(isHttpsLink('https://a.test/x')).toBe(true);
    expect(isHttpsLink('http://a.test')).toBe(false);
    expect(isHttpsLink('javascript:alert(1)')).toBe(false);
    expect(isHttpsLink('https://user:pw@a.test')).toBe(false);
    expect(isHttpsLink('not a url')).toBe(false);
    expect(isHttpsLink(null)).toBe(false);
  });

  it('makes initials for a logo that is missing', () => {
    expect(initialsOf('Just Dial')).toBe('JD');
    expect(initialsOf('webhook')).toBe('WE');
    expect(initialsOf('  ')).toBe('?');
  });

  it('builds every address in one place', () => {
    expect(mktRoutes.app('x')).toBe('/marketplace/app/x');
    expect(mktRoutes.install('x')).toBe('/marketplace/app/x/install');
    expect(mktRoutes.manage(ID(1))).toBe(`/marketplace/installed/${ID(1)}`);
    expect(mktRoutes.browse('mini_app')).toBe('/marketplace/apps');
  });
});
