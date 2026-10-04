import { describe, expect, it, vi } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import {
  ConnectorError,
  ConnectorRegistry,
  PullConnector,
  PushConnector,
  WebhookRelayConnector,
  assertRecipeUrlsPublic,
  classifyHttpFailure,
  hmacHex,
  isInbound,
  isPuller,
  newConnectionSecret,
  newPublicKey,
  recipeUrls,
  renderTemplate,
  secretHint,
  signatureMatches,
  tokenMatches,
  type FetchLike,
} from '../../../src/infra/providers/marketplace';
import {
  EmailParseConnector,
  OAuthConnector,
} from '../../../src/infra/providers/marketplace/framework.connectors';
import { mergeCredentials } from '../../../src/modules/marketplace/credentials';
import { pullRecipe, pushRecipe, relayRecipe } from './fixtures';

const recipe = (input: unknown): MarketRecipe => {
  const v = validateMarketRecipe(input);
  if (!v.ok) throw new Error(JSON.stringify(v.problems));
  return v.recipe;
};

const body = Buffer.from('{"id":"1","name":"A"}');
const secret = 'mkt_test-secret-1234567890';

describe('connector registry', () => {
  const registry = new ConnectorRegistry(
    new OAuthConnector(),
    new PushConnector(),
    new PullConnector(),
    new EmailParseConnector(),
    new WebhookRelayConnector(),
  );

  it('registers the five types of spec 6.3, and only the ones that work end to end are publishable', () => {
    expect(
      registry
        .all()
        .map((t) => t.kind)
        .sort(),
    ).toEqual(['email_parse', 'oauth', 'pull', 'push', 'webhook_relay']);
    expect(registry.isImplemented('webhook_relay')).toBe(true);
    expect(registry.isImplemented('push')).toBe(true);
    // Pull went live with the first portal recipes (IndiaMART, Housing.com, TradeIndia). The others are frameworks only: the first
    // recipe that needs each is verified against its portal, then the flag flips.
    expect(registry.isImplemented('pull')).toBe(true);
    expect(registry.isImplemented('oauth')).toBe(false);
    expect(registry.isImplemented('email_parse')).toBe(false);
  });

  it('knows which types receive deliveries and which poll', () => {
    expect(isInbound(registry.get('webhook_relay'))).toBe(true);
    expect(isInbound(registry.get('push'))).toBe(true);
    // A pull type also receives, for a recipe that declares a `push` door (IndiaMART); for any other pull recipe it describes no address.
    expect(isInbound(registry.get('pull'))).toBe(true);
    expect(isPuller(registry.get('pull'))).toBe(true);
    expect(isPuller(registry.get('webhook_relay'))).toBe(false);
  });

  it('a framework-only type says it is not available when tested', async () => {
    const r = recipe(
      relayRecipe({
        connector: {
          type: 'oauth',
          authorizeUrl: 'https://a.example.com/x',
          tokenUrl: 'https://a.example.com/t',
          clientSettingKey: 'acme',
        },
      }),
    );
    expect(
      await registry.get('oauth').test({ recipe: r, credentials: {}, config: {} }),
    ).toMatchObject({ ok: false, code: 'not_available' });
  });

  it('an email-parse recipe with no required rule is flagged: every alert would become a lead', () => {
    const r = recipe(
      relayRecipe({
        connector: {
          type: 'email_parse',
          senders: ['@p.example.com'],
          rules: [{ to: 'phone', pattern: '(\\d+)' }],
        },
      }),
    );
    expect(registry.get('email_parse').checkRecipe(r)).toHaveLength(1);
  });
});

describe('delivery authentication', () => {
  it('token and signature compare in constant time and accept exactly the right value', () => {
    expect(tokenMatches(secret, secret)).toBe(true);
    expect(tokenMatches(secret, `Bearer ${secret}`)).toBe(true);
    expect(tokenMatches(secret, `${secret}x`)).toBe(false);
    expect(tokenMatches(secret, undefined)).toBe(false);
    const sig = hmacHex(secret, body);
    expect(signatureMatches(secret, body, `sha256=${sig}`)).toBe(true);
    expect(signatureMatches(secret, body, sig.toUpperCase())).toBe(true);
    expect(signatureMatches(secret, Buffer.from('{"id":"2"}'), `sha256=${sig}`)).toBe(false);
    expect(signatureMatches(secret, body, 'sha256=zz')).toBe(false);
    expect(signatureMatches('other', body, `sha256=${sig}`)).toBe(false);
  });

  it('generated secrets and keys have the shape the schema and the database expect', () => {
    expect(newPublicKey()).toMatch(/^[0-9a-f]{32}$/);
    expect(newPublicKey()).not.toBe(newPublicKey());
    const s = newConnectionSecret();
    expect(s).toMatch(/^mkt_[A-Za-z0-9_-]{40,}$/);
    expect(secretHint(s)).toBe(`ends in ${s.slice(-4)}`);
  });

  it('webhook relay: token, hmac or either, as the recipe says', () => {
    const relay = new WebhookRelayConnector();
    const sig = `sha256=${hmacHex(secret, body)}`;
    const headers = (h: Record<string, string>) => ({ rawBody: body, headers: h });
    const either = recipe(relayRecipe());
    expect(relay.authenticate(either, headers({ 'x-marketplace-token': secret }), secret)).toBe(
      true,
    );
    expect(relay.authenticate(either, headers({ 'x-marketplace-signature': sig }), secret)).toBe(
      true,
    );
    expect(relay.authenticate(either, headers({}), secret)).toBe(false);
    const tokenOnly = recipe(relayRecipe({ connector: { type: 'webhook_relay', auth: 'token' } }));
    expect(relay.authenticate(tokenOnly, headers({ 'x-marketplace-signature': sig }), secret)).toBe(
      false,
    );
    const hmacOnly = recipe(relayRecipe({ connector: { type: 'webhook_relay', auth: 'hmac' } }));
    expect(relay.authenticate(hmacOnly, headers({ 'x-marketplace-token': secret }), secret)).toBe(
      false,
    );
    expect(relay.describeAuth(hmacOnly)?.auth).toBe('hmac');
    expect(relay.secretFor(either, { portalKey: 'k' }, 'generated')).toBe('generated');
  });

  it('push: the portal key from the recipe header, or a signature in the recipe header', () => {
    const push = new PushConnector();
    const token = recipe(pushRecipe());
    expect(push.describeAuth(token)).toMatchObject({ auth: 'token', tokenHeader: 'x-acme-key' });
    expect(push.secretFor(token, { portalKey: 'portal-secret' }, 'generated')).toBe(
      'portal-secret',
    );
    expect(push.secretFor(token, {}, 'generated')).toBeNull();
    expect(
      push.authenticate(
        token,
        { rawBody: body, headers: { 'x-acme-key': 'portal-secret' } },
        'portal-secret',
      ),
    ).toBe(true);
    expect(
      push.authenticate(
        token,
        { rawBody: body, headers: { 'x-acme-key': 'nope' } },
        'portal-secret',
      ),
    ).toBe(false);
    // The platform's own header name is not a way in on a recipe that names another header.
    expect(
      push.authenticate(
        token,
        { rawBody: body, headers: { 'x-marketplace-token': 'portal-secret' } },
        'portal-secret',
      ),
    ).toBe(false);

    const hmac = recipe(
      pushRecipe({
        connector: { type: 'push', auth: { scheme: 'hmac_sha256', header: 'X-Acme-Signature' } },
        authFields: [],
      }),
    );
    expect(push.describeAuth(hmac)).toMatchObject({
      auth: 'hmac',
      signatureHeader: 'x-acme-signature',
    });
    expect(push.secretFor(hmac, {}, 'generated')).toBe('generated');
    expect(
      push.authenticate(
        hmac,
        { rawBody: body, headers: { 'x-acme-signature': hmacHex(secret, body) } },
        secret,
      ),
    ).toBe(true);
  });

  it('"test connection" of a receiving type runs the recipe sample through the mapping', async () => {
    const relay = new WebhookRelayConnector();
    expect(
      await relay.test({ recipe: recipe(relayRecipe()), credentials: {}, config: {} }),
    ).toEqual({ ok: true, code: null, message: null });
    const broken = recipe(
      pushRecipe({
        testPayloads: [{ name: 'Bad', payload: { queries: [{ query: { id: 'x' } }] } }],
      }),
    );
    expect(
      await new PushConnector().test({ recipe: broken, credentials: {}, config: {} }),
    ).toMatchObject({ ok: false, code: 'sample_unmapped' });
  });
});

describe('credentials', () => {
  const r = recipe(pushRecipe());

  it('requires the declared required fields, refuses unknown ones, and shows a secret as a hint only', () => {
    const missing = mergeCredentials(r, {}, {});
    expect(missing.problems).toEqual([{ path: 'credentials.portalKey', message: 'Required' }]);
    const stray = mergeCredentials(r, {}, { portalKey: 'abcd1234efgh', hack: 'x' });
    expect(stray.problems).toEqual([
      { path: 'credentials.hack', message: 'This app has no such field' },
    ]);
    const ok = mergeCredentials(r, {}, { portalKey: 'abcd1234efgh', account: 'acme-7' });
    expect(ok.problems).toEqual([]);
    expect(ok.hints).toEqual({ portalKey: 'ends in efgh', account: 'acme-7' });
    expect(JSON.stringify(ok.hints)).not.toContain('abcd1234');
  });

  it('keeps what was not sent, replaces what was, clears optional fields only', () => {
    const existing = { portalKey: 'abcd1234efgh', account: 'acme-7' };
    const kept = mergeCredentials(r, existing, { account: 'acme-8' });
    expect(kept.values).toEqual({ portalKey: 'abcd1234efgh', account: 'acme-8' });
    expect(mergeCredentials(r, existing, {}, ['account']).values).toEqual({
      portalKey: 'abcd1234efgh',
    });
    expect(mergeCredentials(r, existing, {}, ['portalKey']).problems[0]!.message).toBe(
      'A required field cannot be cleared',
    );
  });

  it('a field the recipe no longer has loses its stored value', () => {
    expect(
      mergeCredentials(r, { portalKey: 'abcd1234efgh', gone: 'old-secret' }, {}).values,
    ).toEqual({ portalKey: 'abcd1234efgh' });
  });

  it('a short secret shows no characters at all', () => {
    expect(mergeCredentials(r, {}, { portalKey: 'short' }).hints.portalKey).toBe('set');
  });
});

describe('pull connector (framework)', () => {
  const r = recipe(pullRecipe());
  const creds = { apiKey: 'key 1/2', account: 'acme' };
  const state = {
    cursor: '41',
    since: new Date('2026-10-01T00:00:00Z'),
    now: new Date('2026-10-02T00:00:00Z'),
  };
  const answer =
    (status: number, json: unknown): FetchLike =>
    async () => ({ status, text: async () => JSON.stringify(json) });
  const allow = async () => undefined;

  it('renders the request from its templates: encoded in the path and query, plain in headers', async () => {
    const fetchImpl = vi.fn(answer(200, { data: { items: [] } }));
    await new PullConnector(fetchImpl, allow).pull(
      { recipe: r, credentials: creds, config: {} },
      state,
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://api.portal-example.com/v1/enquiries/key%201%2F2?since=2026-10-01T00%3A00%3A00.000Z&after=41',
    );
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'X-Account': 'acme' });
  });

  it('maps the items to leads and moves the cursor to the greatest id', async () => {
    const items = [
      { id: 40, name: 'Old', mobile: '9876543210' },
      { id: 43, name: 'New', mobile: '9876543211' },
      { id: 42, name: 'Mid' },
    ];
    const out = await new PullConnector(answer(200, { data: { items } }), allow).pull(
      { recipe: r, credentials: creds, config: {} },
      state,
    );
    expect(out.leads.map((l) => l.externalId)).toEqual(['40', '43']);
    expect(out.rejected).toEqual([{ index: 2, reason: 'missing_phone' }]);
    expect(out.nextCursor).toBe('43');
    const none = await new PullConnector(answer(200, { data: { items: [] } }), allow).pull(
      { recipe: r, credentials: creds, config: {} },
      state,
    );
    expect(none.nextCursor).toBe('41');
  });

  it('classifies a refusal by the recipe error mapping, then by sensible defaults', async () => {
    const refused = new PullConnector(answer(401, { error: 'bad' }), allow).pull(
      { recipe: r, credentials: creds, config: {} },
      state,
    );
    await expect(refused).rejects.toMatchObject({
      code: 'bad_key',
      retry: false,
      health: 'needs_reauth',
    });
    expect(classifyHttpFailure(r, 429, '')).toMatchObject({
      code: 'rate_limited',
      retry: true,
      health: 'degraded',
    });
    expect(classifyHttpFailure(r, 503, '')).toMatchObject({ code: 'portal_error', retry: true });
    expect(classifyHttpFailure(r, 403, '')).toMatchObject({
      code: 'auth_rejected',
      health: 'needs_reauth',
    });
    expect(classifyHttpFailure(r, 404, '')).toMatchObject({
      code: 'portal_rejected',
      retry: false,
    });
    const byBody = recipe(
      pullRecipe({
        errorMapping: [
          {
            status: 400,
            bodyContains: 'quota',
            code: 'quota',
            message: 'Quota used up',
            retry: true,
            health: 'degraded',
          },
        ],
      }),
    );
    expect(classifyHttpFailure(byBody, 400, '{"msg":"Daily QUOTA exceeded"}')).toMatchObject({
      code: 'quota',
    });
    expect(classifyHttpFailure(byBody, 400, 'other')).toMatchObject({ code: 'portal_rejected' });
  });

  it('refuses an address the guard refuses, before any request is made', async () => {
    const fetchImpl = vi.fn(answer(200, {}));
    const guard = async () => {
      throw new Error('private');
    };
    await expect(
      new PullConnector(fetchImpl, guard).pull(
        { recipe: r, credentials: creds, config: {} },
        state,
      ),
    ).rejects.toMatchObject({ code: 'url_refused' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a portal that does not answer, or answers something that is not JSON, is a retryable failure', async () => {
    const down: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    await expect(
      new PullConnector(down, allow).pull({ recipe: r, credentials: creds, config: {} }, state),
    ).rejects.toMatchObject({ code: 'portal_unreachable', retry: true });
    const html: FetchLike = async () => ({ status: 200, text: async () => '<html>' });
    await expect(
      new PullConnector(html, allow).pull({ recipe: r, credentials: creds, config: {} }, state),
    ).rejects.toMatchObject({ code: 'bad_answer', retry: true });
    expect(new ConnectorError('x', 'm', false, 'error')).toBeInstanceOf(Error);
  });

  it('renders placeholders without ever printing a literal placeholder', () => {
    const vars = {
      cred: { a: 'x y' },
      config: { region: 'in' },
      cursor: '',
      since_iso: 's',
      now_iso: 'n',
    };
    expect(
      renderTemplate('/{{cred.a}}/{{config.region}}/{{cred.missing}}/{{cursor}}', vars, true),
    ).toBe('/x%20y/in//');
    expect(renderTemplate('{{cred.a}}', vars, false)).toBe('x y');
  });

  it('a pull recipe that declares a cursor must use it', () => {
    const base = pullRecipe().connector as { request: Record<string, unknown> };
    const noUse = recipe(
      pullRecipe({
        connector: {
          ...base,
          cursor: { from: 'id' },
          request: { ...base.request, query: {}, path: '/v1/x' },
        },
      }),
    );
    expect(new PullConnector().checkRecipe(noUse)).toHaveLength(1);
    expect(new PullConnector().checkRecipe(r)).toEqual([]);
  });
});

describe('recipe addresses (where a name points)', () => {
  it('lists every address a recipe calls', () => {
    expect(recipeUrls(recipe(pullRecipe()))).toEqual(['https://api.portal-example.com']);
    expect(recipeUrls(recipe(relayRecipe()))).toEqual([]);
  });

  it('refuses a name that resolves to a private address, accepts one that resolves to public addresses only', async () => {
    const r = recipe(pullRecipe());
    await expect(
      assertRecipeUrlsPublic(r, { resolve: async () => ['10.0.0.5'] }),
    ).rejects.toMatchObject({ name: 'RecipeUrlRefusedError' });
    await expect(
      assertRecipeUrlsPublic(r, { resolve: async () => ['93.184.216.34', '169.254.169.254'] }),
    ).rejects.toThrow();
    await expect(assertRecipeUrlsPublic(r, { resolve: async () => [] })).rejects.toThrow();
    await expect(
      assertRecipeUrlsPublic(r, { resolve: async () => ['93.184.216.34'] }),
    ).resolves.toBeUndefined();
  });
});
