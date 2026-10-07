// Twin spec: the customer REST API (/api/v1) on Reference and on our API, called with an API key.
// Features covered: TW-API-001..007, 009, 020..029, 048..054 (key, auth, rate-limit headers, envelopes, /me, /usage,
// contacts, contact groups, deals).
//
// How it works
//   - Requests go straight to /api/v1 with Node's fetch (no session cookie, no staff token), so the key is the only credential.
//   - Each side's own key is minted through that side's own console: Reference POST /developers/keys (flash-once page),
//     ours POST /v2/developer/keys. The key is minted lazily by the first scenario that needs it and revoked at teardown,
//     only when this run created it.
//   - Scenario ids starting with `api.noauth.` need no account and no key (they send bad or no credentials).
//   - RUN WITH `--workers 1`: `api.auth.revoked-key` revokes the shared key and the next scenario mints a new one.
//   - Reference allows one active key per workspace: the workspace used on the Reference side must have no other active key.
// Observations are side-neutral (logical names); the comparator reports every difference.
export default (h) => {
  const KEYS = { threadwise: null, ours: null }; // { secret, id, minted: bool } per side
  const SEEDS = { threadwise: null, ours: null }; // shared tagged contacts for list/pagination scenarios
  const DEAL_GATE = { threadwise: null, ours: null };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const classOf = (s) =>
    s == null
      ? 'none'
      : s >= 200 && s < 300
        ? 'ok'
        : s >= 300 && s < 400
          ? 'redirect'
          : s === 401
            ? 'unauthenticated'
            : s === 403
              ? 'forbidden'
              : s === 404
                ? 'not-found'
                : s === 405
                  ? 'method-not-allowed'
                  : s === 409
                    ? 'conflict'
                    : s === 413
                      ? 'too-large'
                      : s === 429
                        ? 'throttled'
                        : s === 400 || s === 422
                          ? 'rejected'
                          : s >= 500
                            ? 'crash'
                            : 'client-error';

  // ---------------------------------------------------------------------------------------------------------------
  // transport
  const apiBase = (c) =>
    (c.side === 'threadwise' ? c.sideObj.baseUrl : c.sideObj.apiBase).replace(/\/$/, '') + '/api/v1';

  async function call(c, method, path, o = {}) {
    const headers = { Accept: 'application/json', ...(o.headers || {}) };
    const key = o.key === undefined ? undefined : o.key;
    if (key && !o.xkey) headers.Authorization = `${o.scheme || 'Bearer'} ${key}`;
    if (key && o.xkey) headers['X-Api-Key'] = key;
    let body = o.raw;
    if (body === undefined && o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers['Content-Type'] = 'application/json';
    }
    if (o.form) {
      body = new URLSearchParams(o.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (o.contentType) headers['Content-Type'] = o.contentType;
    if (o.noAccept) delete headers.Accept;
    const qs = o.query ? '?' + new URLSearchParams(o.query).toString() : '';
    const t0 = Date.now();
    const res = await fetch(apiBase(c) + path + qs, { method, headers, body, redirect: 'manual' });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const hd = Object.fromEntries([...res.headers.entries()]);
    c.rec.events.http.push({
      at: Date.now() - c.rec.t0,
      method,
      path: '/api/v1' + path.replace(/[0-9a-f-]{36}|\d+/g, ':id'),
      status: res.status,
      type: 'fetch',
      redirected: false,
    });
    return { status: res.status, headers: hd, text, json, ms: Date.now() - t0 };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // keys: mint through the side's own console, revoke at the end
  async function threadwiseKeyList(c) {
    const r = await c.http('GET', '/developers');
    return { html: typeof r.body === 'string' ? r.body : r.text || '', status: r.status };
  }
  async function mintKey(c) {
    const name = c.tag('apikey').slice(0, 100);
    if (c.side === 'ours') {
      const r = await c.http('POST', '/v2/developer/keys', { data: { name } });
      if (r.status !== 201 || !r.body?.secret)
        throw new Error(`could not mint our key: ${r.status} ${String(r.text).slice(0, 160)}`);
      return { secret: r.body.secret, id: r.body.key.id, minted: true, name };
    }
    const post = await c.http('POST', '/developers/keys', { form: { name } });
    if (post.status >= 400)
      throw new Error(
        `Reference key creation refused: HTTP ${post.status} (is there already an active key?)`,
      );
    const page = await threadwiseKeyList(c); // the raw key is flashed to the next page view
    const m = page.html.match(/wsk_[A-Za-z0-9]{40}/);
    if (!m)
      throw new Error(
        'Reference did not show a new key after creation (a key may already be active in this workspace; revoke it first)',
      );
    const id = (page.html.match(/\/developers\/keys\/(\d+)/) || [])[1];
    return { secret: m[0], id, minted: true, name };
  }
  async function revokeKey(c, k) {
    if (!k) return;
    if (c.side === 'ours') await c.http('DELETE', `/v2/developer/keys/${k.id}`);
    else {
      let id = k.id;
      if (!id) id = ((await threadwiseKeyList(c)).html.match(/\/developers\/keys\/(\d+)/) || [])[1];
      if (id) await c.http('DELETE', `/developers/keys/${id}`);
    }
  }
  const getKey = async (c) => {
    if (!KEYS[c.side])
      KEYS[c.side] = mintKey(c).catch((e) => {
        KEYS[c.side] = null;
        throw e;
      });
    return (await KEYS[c.side]).secret;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // normalisation: each app's response into side-neutral terms
  const ok2xx = (r) => r.status >= 200 && r.status < 300;
  function shape(r) {
    const j = r.json;
    if (r.status >= 300 && r.status < 400) return 'redirect';
    if (j == null) return r.text ? 'non-json' : 'empty';
    if (Array.isArray(j)) return 'array';
    if (j.error && typeof j.error === 'object') return 'error-envelope';
    if (j.errors) return 'laravel-validation';
    if ('data' in j) return j.meta && Object.keys(j.meta).length ? 'data+meta' : 'data';
    if (typeof j.message === 'string') return 'message-only';
    return 'other';
  }
  const isErr = (r) => r.status >= 400;
  function errorCode(r) {
    if (!isErr(r)) return null;
    const j = r.json;
    if (j?.error?.code) return String(j.error.code);
    if (j?.errors) return 'validation_failed';
    if (r.status === 404) return 'not_found';
    if (r.status === 405) return 'method_not_allowed';
    if (r.status === 401) return 'unauthenticated';
    if (r.status === 419) return 'csrf';
    return `http_${r.status}`;
  }
  function flagged(r) {
    const j = r.json;
    const m = j?.error?.details || j?.errors || {};
    return Object.keys(m).filter((k) => k !== '_');
  }
  const idStyle = (id) =>
    id == null
      ? null
      : typeof id === 'number'
        ? 'numeric'
        : UUID.test(String(id))
          ? 'uuid'
          : 'other';
  const digits = (s) => String(s ?? '').replace(/\D/g, '');
  const hasRl = (r) => 'x-ratelimit-limit' in r.headers && 'x-ratelimit-remaining' in r.headers;

  // the standard set of observations every response gets
  function rec(c, r, name = '') {
    const o = c.obs;
    o.set('status.http' + (name ? `.${name}` : ''), classOf(r.status));
    o.num('httpStatus' + (name ? `_${name}` : ''), r.status);
    if (!name) {
      o.enum('envelope', isErr(r) ? 'error' : shape(r));
      o.enum('errorShape', isErr(r) ? shape(r) : null);
      o.enum('errorCode', errorCode(r));
      o.list('flaggedFields', flagged(r));
      o.flag('rateLimitHeaders', hasRl(r));
      o.flag('jsonContentType', /json/i.test(r.headers['content-type'] || ''));
      o.flag('redirected', r.status >= 300 && r.status < 400);
    }
  }

  function contactView(d) {
    if (!d || typeof d !== 'object') return null;
    return {
      name: d.name ?? null,
      phone: d.phone == null ? null : '+' + digits(d.phone),
      email: d.email ?? null,
      tags: Array.isArray(d.tags) ? d.tags.length : -1,
      tagNames: Array.isArray(d.tags)
        ? d.tags
            .map((t) => t.name)
            .sort()
            .join('|')
        : '',
      attrKeys:
        d.attributes && typeof d.attributes === 'object'
          ? Object.keys(d.attributes).sort().join(',')
          : String(d.attributes),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // data helpers (always tagged with this run; deleted only when they carry the tag)
  async function delOwned(c, path, record) {
    if (!c.isMine(record)) {
      c.obs.note(`NOT deleted (not created by this run): ${path}`);
      return false;
    }
    const key = await getKey(c);
    const r = await call(c, 'DELETE', path, { key });
    return ok2xx(r);
  }
  const baseContact = (c, over = {}) => ({
    name: c.tag('contact'),
    phone: '9' + c.digits(9),
    country_code: '+91',
    email: `${c.tag('mail').toLowerCase()}@example.com`,
    ...over,
  });
  // returns the response; registers cleanup when this call really created a row
  async function createContact(c, body, key) {
    const k = key || (await getKey(c));
    const r = await call(c, 'POST', '/contacts', { key: k, body });
    const d = r.json?.data;
    const created = r.status === 201 && d?.id != null && r.json?.meta?.created !== false;
    if (created) c.onCleanup(() => delOwned(c, `/contacts/${d.id}`, d));
    r.created = created;
    return r;
  }
  async function createGroup(c, body, key) {
    const k = key || (await getKey(c));
    const r = await call(c, 'POST', '/contact-groups', { key: k, body });
    const d = r.json?.data;
    if (r.status === 201 && d?.id != null && r.json?.meta?.existing !== true)
      c.onCleanup(() => delOwned(c, `/contact-groups/${d.id}`, d));
    return r;
  }
  const seed = async (c) => {
    if (!SEEDS[c.side])
      SEEDS[c.side] = (async () => {
        const before = c.cleanups.length;
        const out = [];
        for (const label of ['A', 'B', 'C']) {
          const r = await createContact(c, {
            name: `${c.tagBase}-seed-${label}`,
            phone: '9' + c.digits(9),
            country_code: '+91',
            email: `${c.tagBase}-seed-${label.toLowerCase()}@example.com`.toLowerCase(),
          });
          if (!r.created)
            throw new Error(
              `seed contact ${label} not created: ${r.status} ${r.text.slice(0, 120)}`,
            );
          out.push(r.json.data);
          await sleep(1100); // Reference orders by a one-second timestamp
        }
        // the seeds outlive the scenario that made them: cleaned at teardown instead
        c.cleanups.length = before;
        return out;
      })().catch((e) => {
        SEEDS[c.side] = null;
        throw e;
      });
    return SEEDS[c.side];
  };

  // ---------------------------------------------------------------------------------------------------------------
  // scenario builders
  const base = { api: true, needsUi: false };
  const sc = (id, title, tags, run) => ({
    id: `api.${id}`,
    title: `API: ${title}`,
    tags: ['api', ...tags],
    ...base,
    run,
  });
  const noauth = (id, title, tags, run) => ({
    id: `api.noauth.${id}`,
    title: `API (no key): ${title}`,
    tags: ['api', 'auth', 'security', ...tags],
    api: false,
    loggedIn: false,
    needsUi: false,
    run,
  });

  const createCase = (id, title, mut, tags = []) =>
    sc(
      `contacts.create.${id}`,
      `create contact, ${title}`,
      ['contacts', 'validation', ...tags],
      async (c) => {
        const body = typeof mut === 'function' ? mut(c) : { ...baseContact(c), ...mut };
        const r = await createContact(c, body);
        rec(c, r);
        const d = r.json?.data;
        o_(c).flag('accepted', ok2xx(r));
        if (ok2xx(r) && d) {
          c.obs.set('map.stored', contactView(d));
          c.obs.enum('idStyle', idStyle(d.id));
          c.obs.set('set.contactKeys', Object.keys(d).sort());
        }
      },
    );
  const o_ = (c) => c.obs;

  const pad = (s, n, ch = 'a') => s + ch.repeat(Math.max(0, n - s.length));

  // ===============================================================================================================
  const scenarios = [];

  // ---- A. no key / bad key (runnable without any Reference account) ----------------------------------------------
  const BAD40 = 'wsk_' + 'a'.repeat(40);
  const noauthCases = [
    ['missing-key', 'no credentials at all', 'GET', '/contacts', {}],
    [
      'missing-key-write',
      'no credentials on a write',
      'POST',
      '/contacts',
      { body: { name: 'x', phone: '+919999999999' } },
    ],
    ['missing-key-me', 'no credentials on /me', 'GET', '/me', {}],
    [
      'empty-bearer',
      'empty bearer token',
      'GET',
      '/contacts',
      { headers: { Authorization: 'Bearer ' } },
    ],
    [
      'bearer-no-space',
      'scheme without a token',
      'GET',
      '/contacts',
      { headers: { Authorization: 'Bearer' } },
    ],
    ['malformed-short', 'token far too short', 'GET', '/contacts', { key: 'abc' }],
    [
      'wrong-prefix',
      'right length, wrong prefix',
      'GET',
      '/contacts',
      { key: 'sk_' + 'a'.repeat(41) },
    ],
    ['shape-ok-unknown', 'well-formed but unknown key', 'GET', '/contacts', { key: BAD40 }],
    ['too-long', 'a 600 character token', 'GET', '/contacts', { key: 'wsk_' + 'b'.repeat(596) }],
    [
      'basic-scheme',
      'Basic scheme',
      'GET',
      '/contacts',
      { headers: { Authorization: 'Basic d3NrX3Rlc3Q6eA==' } },
    ],
    [
      'lowercase-scheme',
      'lowercase bearer scheme with an unknown key',
      'GET',
      '/contacts',
      { scheme: 'bearer', key: BAD40 },
    ],
    ['xkey-unknown', 'unknown key in X-Api-Key', 'GET', '/contacts', { key: BAD40, xkey: true }],
    ['xkey-empty', 'empty X-Api-Key', 'GET', '/contacts', { headers: { 'X-Api-Key': '' } }],
    ['xkey-malformed', 'malformed X-Api-Key', 'GET', '/contacts', { key: 'nope', xkey: true }],
    [
      'key-in-query',
      'key passed in the query string',
      'GET',
      '/contacts',
      { query: { api_key: BAD40 } },
    ],
    ['unknown-route-anon', 'unknown route, no key', 'GET', '/definitely-not-a-route', {}],
    ['method-anon', 'wrong method on a known route, no key', 'DELETE', '/me', {}],
    [
      'write-malformed-body',
      'broken JSON, no key',
      'POST',
      '/contacts',
      { raw: '{"name":', contentType: 'application/json' },
    ],
  ];
  for (const [id, title, method, path, o] of noauthCases)
    scenarios.push(
      noauth(id, title, [], async (c) => {
        const r = await call(c, method, path, o);
        rec(c, r);
        c.obs.set('sec.unauthContentVisible', ok2xx(r));
        c.obs.info('body', String(r.text).slice(0, 160));
      }),
    );
  scenarios.push(
    noauth('options-preflight', 'CORS preflight from a foreign origin', ['cors'], async (c) => {
      const r = await call(c, 'OPTIONS', '/contacts', {
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });
      c.obs.set('status.preflight', classOf(r.status));
      const ao = r.headers['access-control-allow-origin'] || '';
      c.obs.flag('foreignOriginAllowed', ao === 'https://evil.example' || ao === '*');
      // any origin is fine for a bearer-key API as long as credentials are never allowed with it
      c.obs.set(
        'sec.credentialsAllowedForForeignOrigin',
        /true/i.test(r.headers['access-control-allow-credentials'] || '') && !!ao,
      );
      c.obs.info('allowOrigin', r.headers['access-control-allow-origin'] || null);
    }),
  );

  // ---- B. keyed: authentication details ------------------------------------------------------------------------
  scenarios.push(
    sc('auth.bearer-valid', 'a valid bearer key', ['auth', 'happy'], async (c) => {
      const r = await call(c, 'GET', '/me', { key: await getKey(c) });
      rec(c, r);
    }),
    sc('auth.xkey-valid', 'a valid key in X-Api-Key', ['auth'], async (c) => {
      const r = await call(c, 'GET', '/me', { key: await getKey(c), xkey: true });
      rec(c, r);
    }),
    sc(
      'auth.bad-bearer-good-xkey',
      'unusable bearer plus a valid X-Api-Key',
      ['auth', 'edge'],
      async (c) => {
        const r = await call(c, 'GET', '/me', {
          headers: { Authorization: `Bearer ${BAD40}`, 'X-Api-Key': await getKey(c) },
        });
        rec(c, r);
      },
    ),
    sc(
      'auth.good-bearer-bad-xkey',
      'valid bearer plus a bad X-Api-Key',
      ['auth', 'edge'],
      async (c) => {
        const r = await call(c, 'GET', '/me', {
          headers: { Authorization: `Bearer ${await getKey(c)}`, 'X-Api-Key': BAD40 },
        });
        rec(c, r);
      },
    ),
    sc(
      'auth.lowercase-scheme-valid',
      'lowercase "bearer" scheme with a valid key',
      ['auth', 'edge'],
      async (c) => {
        const r = await call(c, 'GET', '/me', { key: await getKey(c), scheme: 'bearer' });
        rec(c, r);
      },
    ),
    sc(
      'auth.key-with-trailing-space',
      'valid key followed by a space',
      ['auth', 'edge'],
      async (c) => {
        const r = await call(c, 'GET', '/me', { key: (await getKey(c)) + ' ' });
        rec(c, r);
      },
    ),
    sc(
      'auth.key-one-char-off',
      'valid key with the last character changed',
      ['auth', 'edge'],
      async (c) => {
        const k = await getKey(c);
        const r = await call(c, 'GET', '/me', {
          key: k.slice(0, -1) + (k.endsWith('a') ? 'b' : 'a'),
        });
        rec(c, r);
      },
    ),
    sc('auth.key-case-changed', 'valid key upper-cased', ['auth', 'edge'], async (c) => {
      const r = await call(c, 'GET', '/me', { key: (await getKey(c)).toUpperCase() });
      rec(c, r);
    }),
    sc(
      'auth.key-in-query-valid',
      'valid key only in the query string',
      ['auth', 'security'],
      async (c) => {
        const r = await call(c, 'GET', '/me', { query: { api_key: await getKey(c) } });
        rec(c, r);
        c.obs.set('sec.keyAcceptedInQuery', ok2xx(r));
      },
    ),
    sc(
      'auth.ratelimit-headers',
      'rate-limit headers on success and their countdown',
      ['ratelimit'],
      async (c) => {
        const k = await getKey(c);
        const a = await call(c, 'GET', '/me', { key: k });
        const b = await call(c, 'GET', '/me', { key: k });
        c.obs.flag('headersOnSuccess', hasRl(a));
        c.obs.num('limitHeader', Number(a.headers['x-ratelimit-limit'] ?? NaN));
        c.obs.flag(
          'remainingCountsDown',
          Number(b.headers['x-ratelimit-remaining']) < Number(a.headers['x-ratelimit-remaining']),
        );
        c.obs.flag(
          'limitStable',
          a.headers['x-ratelimit-limit'] === b.headers['x-ratelimit-limit'],
        );
        const bad = await call(c, 'GET', '/me', { key: BAD40 });
        c.obs.flag('headersOnAuthFailure', hasRl(bad));
        const nf = await call(c, 'GET', '/contacts/00000000-0000-4000-8000-000000000000', {
          key: k,
        });
        c.obs.flag('headersOnNotFound', hasRl(nf));
        c.obs.info('limit', a.headers['x-ratelimit-limit']);
      },
    ),
    sc('auth.unknown-route-keyed', 'unknown route with a valid key', ['routing'], async (c) => {
      rec(c, await call(c, 'GET', '/definitely-not-a-route', { key: await getKey(c) }));
    }),
    sc('auth.method-not-allowed', 'wrong method on known routes', ['routing'], async (c) => {
      const k = await getKey(c);
      rec(c, await call(c, 'DELETE', '/me', { key: k }), 'delete_me');
      rec(c, await call(c, 'POST', '/usage', { key: k }), 'post_usage');
      rec(c, await call(c, 'PUT', '/contacts', { key: k, body: {} }), 'put_contacts_collection');
    }),
    sc('auth.trailing-slash', 'trailing slash on a route', ['routing', 'edge'], async (c) => {
      rec(c, await call(c, 'GET', '/contacts/', { key: await getKey(c) }));
    }),
    sc('auth.head-request', 'HEAD request', ['routing', 'edge'], async (c) => {
      const r = await call(c, 'HEAD', '/me', { key: await getKey(c) });
      c.obs.set('status.head', classOf(r.status));
    }),
  );

  // ---- C. envelope / content negotiation -----------------------------------------------------------------------
  scenarios.push(
    sc('format.invalid-json', 'a broken JSON body', ['format', 'edge'], async (c) => {
      rec(
        c,
        await call(c, 'POST', '/contacts', {
          key: await getKey(c),
          raw: '{"name": ',
          contentType: 'application/json',
        }),
      );
    }),
    sc('format.empty-body', 'POST with no body', ['format', 'edge'], async (c) => {
      rec(c, await call(c, 'POST', '/contacts', { key: await getKey(c) }));
    }),
    sc('format.array-body', 'a JSON array instead of an object', ['format', 'edge'], async (c) => {
      rec(
        c,
        await call(c, 'POST', '/contacts', {
          key: await getKey(c),
          raw: '[]',
          contentType: 'application/json',
        }),
      );
    }),
    sc('format.string-body', 'a bare JSON string', ['format', 'edge'], async (c) => {
      rec(
        c,
        await call(c, 'POST', '/contacts', {
          key: await getKey(c),
          raw: '"hello"',
          contentType: 'application/json',
        }),
      );
    }),
    sc('format.form-encoded', 'a form-encoded body', ['format'], async (c) => {
      const b = baseContact(c);
      const r = await call(c, 'POST', '/contacts', {
        key: await getKey(c),
        form: { name: b.name, phone: b.phone, country_code: b.country_code, email: b.email },
      });
      rec(c, r);
      const d = r.json?.data;
      if (r.status === 201 && d?.id && r.json?.meta?.created !== false)
        c.onCleanup(() => delOwned(c, `/contacts/${d.id}`, d));
    }),
    sc('format.text-plain', 'a text/plain body', ['format', 'edge'], async (c) => {
      rec(
        c,
        await call(c, 'POST', '/contacts', {
          key: await getKey(c),
          raw: JSON.stringify(baseContact(c)),
          contentType: 'text/plain',
        }),
      );
    }),
    sc(
      'format.no-accept-header',
      'a validation error without an Accept header',
      ['format'],
      async (c) => {
        rec(
          c,
          await call(c, 'POST', '/contacts', {
            key: await getKey(c),
            body: { name: 'x' },
            noAccept: true,
          }),
        );
      },
    ),
    sc('format.huge-body', 'a 2 MB request body', ['format', 'edge', 'limits'], async (c) => {
      const r = await call(c, 'POST', '/contacts', {
        key: await getKey(c),
        body: { name: 'x'.repeat(2 * 1024 * 1024), phone: '+919999999999' },
      });
      rec(c, r);
      if (r.status === 201 && r.json?.data?.id)
        c.onCleanup(() => delOwned(c, `/contacts/${r.json.data.id}`, r.json.data));
    }),
    sc('format.null-byte', 'a NUL character in a name', ['format', 'edge'], async (c) => {
      const r = await createContact(c, { ...baseContact(c), name: `${c.tag('nul')}\u0000x` });
      rec(c, r);
    }),
  );

  // ---- D. account ----------------------------------------------------------------------------------------------
  const keysOf = (x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort() : [];
  scenarios.push(
    sc('me.fields', 'GET /me field sets', ['account', 'happy'], async (c) => {
      const r = await call(c, 'GET', '/me', { key: await getKey(c) });
      rec(c, r);
      const d = r.json?.data || {};
      c.obs.set('set.dataKeys', keysOf(d));
      c.obs.set('set.accountKeys', keysOf(d.account));
      c.obs.set('set.workspaceKeys', keysOf(d.workspace));
      c.obs.set('set.planKeys', keysOf(d.plan));
      c.obs.set('set.limitKeys', keysOf(d.limits));
      c.obs.enum('workspaceIdStyle', idStyle(d.workspace?.id));
      c.obs.enum('planNameType', d.plan?.name == null ? 'null' : typeof d.plan.name);
      c.obs.enum('planIsFreeType', typeof d.plan?.is_free);
      c.obs.enum(
        'featuresType',
        d.features && typeof d.features === 'object'
          ? Array.isArray(d.features)
            ? 'array'
            : 'object'
          : String(d.features),
      );
      c.obs.flag(
        'featuresAllTrue',
        Object.values(d.features || {}).every((v) => v === true),
      );
      c.obs.flag(
        'limitsNullOrInt',
        Object.values(d.limits || {}).every((v) => v === null || Number.isInteger(v)),
      );
      c.obs.flag(
        'accountHasEmail',
        typeof d.account?.email === 'string' && d.account.email.includes('@'),
      );
      c.obs.info('limits', d.limits);
    }),
    sc(
      'me.with-query-noise',
      'GET /me ignores unknown query params',
      ['account', 'edge'],
      async (c) => {
        const r = await call(c, 'GET', '/me', {
          key: await getKey(c),
          query: { foo: 'bar', limit: '5' },
        });
        rec(c, r);
      },
    ),
    sc('usage.fields', 'GET /usage field sets', ['account', 'happy'], async (c) => {
      const r = await call(c, 'GET', '/usage', { key: await getKey(c) });
      rec(c, r);
      const d = r.json?.data || {};
      c.obs.set('set.dataKeys', keysOf(d));
      c.obs.set('set.periodKeys', keysOf(d.period));
      c.obs.set('set.planKeys', keysOf(d.plan));
      c.obs.set('set.messagesKeys', keysOf(d.messages));
      const m0 = Object.values(d.meters || {})[0];
      c.obs.set('set.meterKeys', keysOf(m0));
      c.obs.set('set.meterNames', keysOf(d.meters));
      c.obs.enum('creditsType', d.credits === null ? 'null' : typeof d.credits);
      c.obs.enum('periodResetsType', typeof d.period?.resets_on);
      c.obs.flag('resetsOnIsIso', /^\d{4}-\d{2}-\d{2}/.test(String(d.period?.resets_on || '')));
      c.obs.flag('daysLeftInt', Number.isInteger(d.period?.days_left));
      c.obs.flag('messagesUnlimitedBoolean', typeof d.messages?.unlimited === 'boolean');
      c.obs.flag('unlimitedHasNullLimit', d.messages?.unlimited ? d.messages.limit === null : true);
      c.obs.info('usage', d);
    }),
  );

  // ---- E. contacts: create -------------------------------------------------------------------------------------
  scenarios.push(
    createCase(
      'valid',
      'full valid input',
      (c) => ({
        ...baseContact(c),
        first_name: 'Ada',
        last_name: 'Lovelace',
        title: 'Dr',
        language: 'en',
        address: '12 Analytical St',
        note: 'run note',
        attributes: { plan: 'gold', n: 3, ok: true },
        is_unsubscribed: false,
      }),
      ['happy'],
    ),
    createCase('minimal', 'name and phone only', (c) => ({
      name: c.tag('min'),
      phone: '+91' + '9' + c.digits(9),
      email: `${c.tag('m').toLowerCase()}@example.com`,
    })),
    createCase('first-name-only', 'first_name without name (name composed from parts)', (c) => ({
      first_name: c.tag('first'),
      last_name: 'Last',
      title: 'Ms',
      phone: '9' + c.digits(9),
      country_code: '+91',
      email: `${c.tag('fn').toLowerCase()}@example.com`,
    })),
    createCase(
      'no-name-no-first',
      'neither name nor first_name',
      (c) => ({
        phone: '9' + c.digits(9),
        country_code: '+91',
        email: `${c.tag('nn').toLowerCase()}@example.com`,
      }),
      ['required'],
    ),
    createCase('name-empty', 'name empty string', { name: '' }, ['required']),
    createCase('name-spaces', 'name only spaces', { name: '     ' }, ['required']),
    createCase('name-null', 'name null', { name: null }, ['required']),
    createCase('name-number', 'name sent as a number', { name: 12345 }),
    createCase('name-array', 'name sent as an array', { name: ['a'] }),
    createCase('name-191', 'name at the 191 limit', (c) => ({
      ...baseContact(c),
      name: pad(c.tag('n191') + '-', 191),
    })),
    createCase('name-192', 'name one over the limit', (c) => ({
      ...baseContact(c),
      name: pad(c.tag('n192') + '-', 192),
    })),
    createCase('name-padded', 'name with surrounding spaces', (c) => ({
      ...baseContact(c),
      name: `  ${c.tag('pad')}  `,
    })),
    createCase('name-unicode', 'unicode name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('uni')} Zoë 李雷 Ñandú`,
    })),
    createCase('name-emoji', '4-byte characters in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('emo')} 🎉🚀`,
    })),
    createCase('name-rtl', 'right-to-left name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('rtl')} مرحبا`,
    })),
    createCase('name-html', 'markup in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('html')} <b>x</b> & <i>y</i>`,
    })),
    createCase('name-script', 'script tag in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('xss')} <script>alert(1)</script>`,
    })),
    createCase('name-sql', 'SQL in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('sql')} '); DROP TABLE contacts;--`,
    })),
    createCase('name-newline', 'newline in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('nl')}\nsecond line`,
    })),
    createCase('name-template', 'template tokens in the name', (c) => ({
      ...baseContact(c),
      name: `${c.tag('tpl')} {{7*7}} \${x}`,
    })),
    createCase(
      'first-name-192',
      'first_name over 191',
      (c) => ({
        ...baseContact(c),
        name: undefined,
        first_name: pad(c.tag('f192') + '-', 192),
        email: `${c.tag('f').toLowerCase()}@example.com`,
      }),
      ['required'],
    ),
    createCase('middle-name-192', 'middle_name over 191', (c) => ({
      ...baseContact(c),
      middle_name: 'm'.repeat(192),
    })),
    createCase('last-name-192', 'last_name over 191', (c) => ({
      ...baseContact(c),
      last_name: 'l'.repeat(192),
    })),
    createCase('title-50', 'title at 50', (c) => ({ ...baseContact(c), title: 't'.repeat(50) })),
    createCase('title-51', 'title over 50', (c) => ({ ...baseContact(c), title: 't'.repeat(51) })),
    createCase(
      'phone-missing',
      'phone left out',
      (c) => ({ name: c.tag('np'), email: `${c.tag('np').toLowerCase()}@example.com` }),
      ['required'],
    ),
    createCase('phone-empty', 'phone empty string', { phone: '' }, ['required']),
    createCase('phone-spaces', 'phone only spaces', { phone: '    ' }, ['required']),
    createCase('phone-null', 'phone null', { phone: null }, ['required']),
    createCase('phone-number-type', 'phone sent as a JSON number', (c) => ({
      ...baseContact(c),
      country_code: undefined,
      phone: Number('91' + '9' + c.digits(9)),
    })),
    createCase('phone-letters', 'phone with letters', { phone: 'abcdefghij' }),
    createCase('phone-short', 'phone too short', { phone: '12', country_code: undefined }),
    createCase('phone-32', 'phone of 32 characters', {
      phone: '9'.repeat(32),
      country_code: undefined,
    }),
    createCase('phone-33', 'phone of 33 characters', {
      phone: '9'.repeat(33),
      country_code: undefined,
    }),
    createCase('phone-with-plus-cc', 'international format with plus and no country_code', (c) => ({
      ...baseContact(c),
      country_code: undefined,
      phone: '+91' + '9' + c.digits(9),
    })),
    createCase('phone-spaced', 'phone with spaces and dashes', (c) => {
      const d = '9' + c.digits(9);
      return {
        ...baseContact(c),
        phone: `${d.slice(0, 5)} ${d.slice(5)}`.replace(/(\d{3})(\d)/, '$1-$2'),
      };
    }),
    createCase('phone-parens', 'phone with parentheses', (c) => {
      const d = '9' + c.digits(9);
      return { ...baseContact(c), phone: `(${d.slice(0, 3)}) ${d.slice(3)}` };
    }),
    createCase('phone-local-no-cc', 'ten local digits, no plus, no country_code', (c) => ({
      ...baseContact(c),
      country_code: undefined,
      phone: '9' + c.digits(9),
    })),
    createCase('phone-leading-zeros', 'phone with a leading zero', (c) => ({
      ...baseContact(c),
      phone: '0' + '9' + c.digits(9),
    })),
    createCase('phone-cc-already-in-phone', 'country code already inside the phone', (c) => ({
      ...baseContact(c),
      country_code: '+91',
      phone: '+91' + '9' + c.digits(9),
    })),
    createCase('country-code-no-plus', 'country_code without plus', (c) => ({
      ...baseContact(c),
      country_code: '91',
    })),
    createCase('country-code-10', 'country_code of 10 characters', (c) => ({
      ...baseContact(c),
      country_code: '+91' + '0'.repeat(7),
    })),
    createCase('country-code-11', 'country_code of 11 characters', (c) => ({
      ...baseContact(c),
      country_code: '+91' + '0'.repeat(8),
    })),
    createCase('country-code-letters', 'country_code "IN"', (c) => ({
      ...baseContact(c),
      country_code: 'IN',
    })),
    createCase('email-invalid', 'email without @', (c) => ({
      ...baseContact(c),
      email: 'not-an-email',
    })),
    createCase('email-spaces', 'email with a space', (c) => ({
      ...baseContact(c),
      email: 'pat example@example.com',
    })),
    createCase('email-empty', 'email empty string', { email: '' }),
    createCase('email-null', 'email null', { email: null }),
    createCase('email-uppercase', 'uppercase email', (c) => ({
      ...baseContact(c),
      email: `${c.tag('up').toUpperCase()}@EXAMPLE.COM`,
    })),
    createCase('email-plus', 'plus-addressed email', (c) => ({
      ...baseContact(c),
      email: `${c.tag('pl').toLowerCase()}+x@example.com`,
    })),
    createCase('email-191', 'email at 191 characters', (c) => {
      const tail = '@example.com';
      const head = c.tag('e191').toLowerCase() + '.';
      return {
        ...baseContact(c),
        email: head + 'a'.repeat(191 - tail.length - head.length) + tail,
      };
    }),
    createCase('email-192', 'email at 192 characters', (c) => {
      const tail = '@example.com';
      const head = c.tag('e192').toLowerCase() + '.';
      return {
        ...baseContact(c),
        email: head + 'a'.repeat(192 - tail.length - head.length) + tail,
      };
    }),
    createCase('email-unicode', 'internationalised email', (c) => ({
      ...baseContact(c),
      email: `${c.tag('iu').toLowerCase()}ñ@example.com`,
    })),
    createCase('email-number', 'email sent as a number', { email: 12345 }),
    createCase('language-80', 'language at 80', (c) => ({
      ...baseContact(c),
      language: 'l'.repeat(80),
    })),
    createCase('language-81', 'language over 80', (c) => ({
      ...baseContact(c),
      language: 'l'.repeat(81),
    })),
    createCase('address-1000', 'address at 1000', (c) => ({
      ...baseContact(c),
      address: 'a'.repeat(1000),
    })),
    createCase('address-1001', 'address over 1000', (c) => ({
      ...baseContact(c),
      address: 'a'.repeat(1001),
    })),
    createCase('note-2000', 'note at 2000', (c) => ({ ...baseContact(c), note: 'n'.repeat(2000) })),
    createCase('note-2001', 'note over 2000', (c) => ({
      ...baseContact(c),
      note: 'n'.repeat(2001),
    })),
    createCase('attributes-object', 'attributes with nested values', (c) => ({
      ...baseContact(c),
      attributes: { a: { b: [1, 2] }, 'k.dot': 'x', '<b>': 'y' },
    })),
    createCase('attributes-list', 'attributes sent as a list', (c) => ({
      ...baseContact(c),
      attributes: ['a', 'b'],
    })),
    createCase('attributes-string', 'attributes sent as a string', (c) => ({
      ...baseContact(c),
      attributes: 'plan=gold',
    })),
    createCase('attributes-null', 'attributes null', (c) => ({
      ...baseContact(c),
      attributes: null,
    })),
    createCase('attributes-empty', 'attributes empty object', (c) => ({
      ...baseContact(c),
      attributes: {},
    })),
    createCase('unsub-true', 'is_unsubscribed true', (c) => ({
      ...baseContact(c),
      is_unsubscribed: true,
    })),
    createCase('unsub-string-1', 'is_unsubscribed "1"', (c) => ({
      ...baseContact(c),
      is_unsubscribed: '1',
    })),
    createCase('unsub-yes', 'is_unsubscribed "yes"', (c) => ({
      ...baseContact(c),
      is_unsubscribed: 'yes',
    })),
    createCase('unsub-2', 'is_unsubscribed 2', (c) => ({ ...baseContact(c), is_unsubscribed: 2 })),
    createCase('unsub-null', 'is_unsubscribed null', (c) => ({
      ...baseContact(c),
      is_unsubscribed: null,
    })),
    createCase('unknown-field', 'an unknown extra field', (c) => ({
      ...baseContact(c),
      surprise: 'x',
      id: 'client-chosen',
    })),
    createCase('group-ids-not-array', 'group_ids is a string', (c) => ({
      ...baseContact(c),
      group_ids: 'abc',
    })),
    createCase('group-ids-unknown', 'group_ids with an unknown id', (c) => ({
      ...baseContact(c),
      group_ids: [c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa'],
    })),
    createCase('group-ids-garbage', 'group_ids with a non-id value', (c) => ({
      ...baseContact(c),
      group_ids: ['not-an-id'],
    })),
    createCase('group-ids-null-item', 'group_ids with a null item', (c) => ({
      ...baseContact(c),
      group_ids: [null],
    })),
    createCase('group-ids-empty', 'group_ids empty list', (c) => ({
      ...baseContact(c),
      group_ids: [],
    })),
  );

  scenarios.push(
    sc(
      'contacts.create.with-group',
      'create contact in a real group, tags come back',
      ['contacts', 'groups'],
      async (c) => {
        const g = await createGroup(c, { name: c.tag('grp') });
        const gid = g.json?.data?.id;
        const r = await createContact(c, { ...baseContact(c), group_ids: [gid] });
        rec(c, r);
        const d = r.json?.data;
        c.obs.flag('accepted', ok2xx(r));
        c.obs.set('map.stored', contactView(d));
        c.obs.flag('tagIdMatchesGroup', d?.tags?.[0]?.id === gid);
        c.obs.set('set.tagKeys', keysOf(d?.tags?.[0]));
        const list = await call(c, 'GET', '/contact-groups', { key: await getKey(c) });
        const mine = (list.json?.data || []).find((x) => x.id === gid);
        c.obs.num('groupContactsCount', mine?.contacts_count ?? -1);
      },
    ),
    sc(
      'contacts.create.duplicate-phone',
      'the same phone twice',
      ['contacts', 'unique'],
      async (c) => {
        const b = baseContact(c);
        const a = await createContact(c, b);
        const b2 = await createContact(c, {
          ...b,
          name: c.tag('dup2'),
          email: `${c.tag('dup2').toLowerCase()}@example.com`,
        });
        c.obs.flag('firstAccepted', ok2xx(a));
        rec(c, b2);
        c.obs.flag('secondIsNewRow', !!b2.created);
        c.obs.flag(
          'sameIdReturned',
          a.json?.data?.id != null && a.json?.data?.id === b2.json?.data?.id,
        );
      },
    ),
    sc(
      'contacts.create.duplicate-email',
      'the same email twice, different phones',
      ['contacts', 'unique'],
      async (c) => {
        const b = baseContact(c);
        const a = await createContact(c, b);
        const b2 = await createContact(c, {
          ...b,
          name: c.tag('dupe2'),
          phone: '9' + c.digits(9).split('').reverse().join(''),
        });
        c.obs.flag('firstAccepted', ok2xx(a));
        rec(c, b2);
        c.obs.flag('secondIsNewRow', !!b2.created);
      },
    ),
    sc(
      'contacts.create.double-submit',
      'two identical requests at once',
      ['contacts', 'idempotency'],
      async (c) => {
        const b = baseContact(c);
        const k = await getKey(c);
        const [x, y] = await Promise.all([
          call(c, 'POST', '/contacts', { key: k, body: b }),
          call(c, 'POST', '/contacts', { key: k, body: b }),
        ]);
        for (const r of [x, y]) {
          const d = r.json?.data;
          if (r.status === 201 && d?.id) c.onCleanup(() => delOwned(c, `/contacts/${d.id}`, d));
        }
        c.obs.num('submitRequests', 2);
        c.obs.num(
          'rowsCreated',
          new Set(
            [x, y]
              .filter((r) => r.status === 201 && r.json?.meta?.created !== false)
              .map((r) => r.json?.data?.id),
          ).size,
        );
        c.obs.set('set.statuses', [classOf(x.status), classOf(y.status)]);
      },
    ),
  );

  // ---- F. contacts: read / list / pagination ------------------------------------------------------------------
  scenarios.push(
    sc('contacts.show.valid', 'GET one contact', ['contacts', 'happy'], async (c) => {
      const r0 = await createContact(c, baseContact(c));
      const id = r0.json?.data?.id;
      const r = await call(c, 'GET', `/contacts/${id}`, { key: await getKey(c) });
      rec(c, r);
      c.obs.set('map.stored', contactView(r.json?.data));
      c.obs.set('set.contactKeys', keysOf(r.json?.data));
      c.obs.flag('sameAsCreate', JSON.stringify(r.json?.data) === JSON.stringify(r0.json?.data));
    }),
    sc(
      'contacts.show.unknown',
      'GET an id that does not exist',
      ['contacts', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'GET',
            `/contacts/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c) },
          ),
        );
      },
    ),
    sc(
      'contacts.show.foreign',
      'GET a record that exists but is not this workspace',
      ['contacts', 'tenant'],
      async (c) => {
        // Reference: id 1 is the oldest contact of the whole installation, a record of the seeded workspace, not ours.
        // Ours: a well-formed uuid that no workspace of this run owns (a second tenant is not available on both sides).
        const r = await call(
          c,
          'GET',
          `/contacts/${c.side === 'threadwise' ? '1' : 'ffffffff-ffff-4fff-8fff-ffffffffffff'}`,
          { key: await getKey(c) },
        );
        c.obs.enum('crossTenant', classOf(r.status));
        c.obs.flag('noRecordLeaked', !(r.json?.data && r.json.data.email));
      },
    ),
    sc('contacts.show.not-an-id', 'GET /contacts/abc', ['contacts', 'edge'], async (c) => {
      rec(c, await call(c, 'GET', '/contacts/abc', { key: await getKey(c) }));
    }),
    sc(
      'contacts.show.sql-id',
      'GET with an injection-shaped id',
      ['contacts', 'edge', 'security'],
      async (c) => {
        const r = await call(c, 'GET', `/contacts/${encodeURIComponent("1' OR '1'='1")}`, {
          key: await getKey(c),
        });
        rec(c, r);
        c.obs.set('sec.recordLeaked', !!(r.json?.data && r.json.data.email));
      },
    ),
    sc('contacts.show.zero-negative', 'GET id 0 and -1', ['contacts', 'edge'], async (c) => {
      const k = await getKey(c);
      rec(c, await call(c, 'GET', '/contacts/0', { key: k }), 'zero');
      rec(c, await call(c, 'GET', '/contacts/-1', { key: k }), 'negative');
    }),
    sc(
      'contacts.list.shape',
      'list shape and envelope',
      ['contacts', 'list', 'happy'],
      async (c) => {
        await seed(c);
        const r = await call(c, 'GET', '/contacts', {
          key: await getKey(c),
          query: { search: `${c.tagBase}-seed` },
        });
        rec(c, r);
        c.obs.num('itemsReturned', (r.json?.data || []).length);
        c.obs.set('set.contactKeys', keysOf((r.json?.data || [])[0]));
        c.obs.set('set.metaKeys', keysOf(r.json?.meta));
        c.obs.flag('dataIsArray', Array.isArray(r.json?.data));
      },
    ),
    sc(
      'contacts.list.newest-first',
      'the list is newest first',
      ['contacts', 'list'],
      async (c) => {
        await seed(c);
        const r = await call(c, 'GET', '/contacts', {
          key: await getKey(c),
          query: { search: `${c.tagBase}-seed` },
        });
        c.obs.seq(
          'order',
          (r.json?.data || []).map((x) => String(x.name).split('-seed-')[1]),
        );
      },
    ),
    ...[
      ['per-page-1', { per_page: '1' }],
      ['per-page-0', { per_page: '0' }],
      ['per-page-negative', { per_page: '-5' }],
      ['per-page-100', { per_page: '100' }],
      ['per-page-101', { per_page: '101' }],
      ['per-page-1000', { per_page: '1000' }],
      ['per-page-text', { per_page: 'abc' }],
      ['per-page-float', { per_page: '1.5' }],
      ['per-page-empty', { per_page: '' }],
      ['limit-2', { limit: '2' }],
      ['limit-0', { limit: '0' }],
      ['limit-negative', { limit: '-1' }],
      ['limit-500', { limit: '500' }],
      ['limit-text', { limit: 'abc' }],
      ['limit-and-per-page', { limit: '1', per_page: '3' }],
    ].map(([id, q]) =>
      sc(
        `contacts.list.${id}`,
        `page size ${JSON.stringify(q)}`,
        ['contacts', 'list', 'pagination', 'edge'],
        async (c) => {
          await seed(c);
          const r = await call(c, 'GET', '/contacts', {
            key: await getKey(c),
            query: { ...q, search: `${c.tagBase}-seed` },
          });
          rec(c, r);
          const m = r.json?.meta || {};
          c.obs.num('itemsReturned', (r.json?.data || []).length);
          c.obs.num('pageSizeInMeta', m.limit ?? m.per_page ?? null);
        },
      ),
    ),
    sc(
      'contacts.list.page-param',
      'the page parameter',
      ['contacts', 'list', 'pagination'],
      async (c) => {
        await seed(c);
        const r = await call(c, 'GET', '/contacts', {
          key: await getKey(c),
          query: { page: '2', per_page: '1', search: `${c.tagBase}-seed` },
        });
        rec(c, r);
        c.obs.num('itemsReturned', (r.json?.data || []).length);
      },
    ),
    sc(
      'contacts.list.page-garbage',
      'page=abc and page=0',
      ['contacts', 'list', 'pagination', 'edge'],
      async (c) => {
        const k = await getKey(c);
        rec(c, await call(c, 'GET', '/contacts', { key: k, query: { page: 'abc' } }), 'abc');
        rec(c, await call(c, 'GET', '/contacts', { key: k, query: { page: '0' } }), 'zero');
      },
    ),
    sc(
      'contacts.list.cursor-garbage',
      'a cursor that was never issued',
      ['contacts', 'list', 'pagination', 'edge'],
      async (c) => {
        const k = await getKey(c);
        rec(
          c,
          await call(c, 'GET', '/contacts', { key: k, query: { cursor: 'not-a-cursor' } }),
          'junk',
        );
        rec(
          c,
          await call(c, 'GET', '/contacts', { key: k, query: { cursor: 'x'.repeat(5000) } }),
          'long',
        );
      },
    ),
    sc(
      'contacts.list.walk',
      'walk every page with per_page 1',
      ['contacts', 'list', 'pagination'],
      async (c) => {
        const seeds = await seed(c);
        const k = await getKey(c);
        const names = [];
        let requests = 0;
        let cursor;
        let page = 1;
        for (let i = 0; i < 8; i++) {
          const query = { per_page: '1', search: `${c.tagBase}-seed` };
          if (c.side === 'ours' && cursor) query.cursor = cursor;
          if (c.side === 'threadwise') query.page = String(page);
          const r = await call(c, 'GET', '/contacts', { key: k, query });
          requests++;
          const items = r.json?.data || [];
          names.push(...items.map((x) => x.name));
          if (c.side === 'ours') {
            cursor = r.json?.meta?.next_cursor;
            if (!r.json?.meta?.has_more || !cursor) break;
          } else {
            if (page >= (r.json?.meta?.last_page ?? 1)) break;
            page++;
          }
        }
        c.obs.num('requests', requests);
        c.obs.num('itemsSeen', names.length);
        c.obs.flag('noDuplicates', new Set(names).size === names.length);
        c.obs.flag(
          'sawAllSeeds',
          seeds.every((s) => names.includes(s.name)),
        );
      },
    ),
    ...[
      ['hit-name', `${'__TAG__'}-seed-a`],
      ['hit-case', `${'__TAG__'}-SEED-B`],
      ['miss', 'zz-no-such-contact-zz'],
      ['percent', '%'],
      ['underscore', '_'],
      ['quote', "'"],
      ['sql', "' OR 1=1 --"],
      ['backslash', '\\'],
      ['script', '<script>1</script>'],
      ['spaces', '    '],
      ['unicode', '李雷'],
      ['long-200', 'a'.repeat(200)],
      ['long-201', 'a'.repeat(201)],
      ['long-1000', 'a'.repeat(1000)],
      ['padded', '  __TAG__-seed-c  '],
      ['phone-fragment', 'PHONE'],
      ['email-fragment', '@example.com'],
    ].map(([id, term]) =>
      sc(
        `contacts.list.search-${id}`,
        `search ${id}`,
        ['contacts', 'list', 'search', 'edge'],
        async (c) => {
          const seeds = await seed(c);
          const t = term
            .replace('__TAG__', c.tagBase)
            .replace('PHONE', digits(seeds[0].phone).slice(-6));
          const r = await call(c, 'GET', '/contacts', {
            key: await getKey(c),
            query: { search: t },
          });
          rec(c, r);
          const n = (r.json?.data || []).length;
          c.obs.flag('anyResult', n > 0);
          c.obs.flag(
            'onlyRunData',
            (r.json?.data || []).every((x) => c.isMine(x)),
          );
        },
      ),
    ),
  );

  // ---- G. contacts: update / delete ----------------------------------------------------------------------------
  const withContact = async (c, extra = {}) => {
    const r = await createContact(c, { ...baseContact(c), ...extra });
    if (!r.created)
      throw new Error(
        `could not create the contact to update: ${r.status} ${r.text.slice(0, 120)}`,
      );
    return r.json.data;
  };
  const updateCase = (id, title, mut, tags = []) =>
    sc(
      `contacts.update.${id}`,
      `update contact, ${title}`,
      ['contacts', 'update', ...tags],
      async (c) => {
        const d0 = await withContact(c, { attributes: { keep: 'me' } });
        const body = typeof mut === 'function' ? mut(c, d0) : mut;
        const r = await call(c, 'PUT', `/contacts/${d0.id}`, { key: await getKey(c), body });
        rec(c, r);
        c.obs.set('map.after', contactView(r.json?.data));
        c.obs.set('map.before', contactView(d0));
        const g = await call(c, 'GET', `/contacts/${d0.id}`, { key: await getKey(c) });
        c.obs.set('map.stored', contactView(g.json?.data));
      },
    );
  scenarios.push(
    updateCase('name-only', 'only the name', (c) => ({ name: c.tag('renamed') }), ['happy']),
    updateCase('empty-body', 'empty object changes nothing', {}),
    updateCase('name-empty', 'name empty string keeps the old name', { name: '' }),
    updateCase('name-null', 'name null', { name: null }),
    updateCase('name-192', 'name over 191', { name: 'n'.repeat(192) }),
    updateCase('first-name-recompute', 'first_name recomputes the display name', {
      first_name: 'Grace',
      last_name: 'Hopper',
      title: 'Adm',
    }),
    updateCase('phone-new', 'a new phone', (c) => ({
      phone: '9' + c.digits(9).split('').reverse().join(''),
      country_code: '+91',
    })),
    updateCase('phone-invalid', 'an invalid phone', { phone: 'abcdef' }),
    updateCase('phone-null', 'phone null', { phone: null }),
    updateCase('phone-empty', 'phone empty string', { phone: '' }),
    updateCase('email-null', 'email null clears it', { email: null }),
    updateCase('email-invalid', 'invalid email', { email: 'nope' }),
    updateCase('attributes-empty', 'attributes {} clears them', { attributes: {} }),
    updateCase('attributes-replace', 'attributes replace the object', { attributes: { other: 1 } }),
    updateCase('group-ids-empty', 'group_ids [] detaches', { group_ids: [] }),
    updateCase('group-ids-unknown', 'group_ids unknown', (c) => ({
      group_ids: [c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa'],
    })),
    updateCase('unsub', 'is_unsubscribed true', { is_unsubscribed: true }),
    updateCase('unsub-bad', 'is_unsubscribed "maybe"', { is_unsubscribed: 'maybe' }),
    updateCase('id-in-body', 'an id in the body is ignored', { id: 'something-else', name: 'x' }),
    sc(
      'contacts.update.groups-attach',
      'attach and then detach a group',
      ['contacts', 'update', 'groups'],
      async (c) => {
        const g = await createGroup(c, { name: c.tag('att') });
        const gid = g.json?.data?.id;
        const d0 = await withContact(c);
        const k = await getKey(c);
        const a = await call(c, 'PUT', `/contacts/${d0.id}`, {
          key: k,
          body: { group_ids: [gid] },
        });
        c.obs.num('tagsAfterAttach', a.json?.data?.tags?.length ?? -1);
        const b = await call(c, 'PUT', `/contacts/${d0.id}`, { key: k, body: { group_ids: [] } });
        c.obs.num('tagsAfterDetach', b.json?.data?.tags?.length ?? -1);
      },
    ),
    sc(
      'contacts.update.unknown',
      'update an id that does not exist',
      ['contacts', 'update', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'PUT',
            `/contacts/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c), body: { name: 'x' } },
          ),
        );
      },
    ),
    sc(
      'contacts.update.unknown-bad-body',
      'unknown id with an invalid body (which error wins)',
      ['contacts', 'update', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'PUT',
            `/contacts/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c), body: { email: 'nope' } },
          ),
        );
      },
    ),
    sc(
      'contacts.update.foreign',
      'update a record of another workspace',
      ['contacts', 'update', 'tenant'],
      async (c) => {
        const r = await call(
          c,
          'PUT',
          `/contacts/${c.side === 'threadwise' ? '1' : 'ffffffff-ffff-4fff-8fff-ffffffffffff'}`,
          { key: await getKey(c), body: { name: c.tag('hijack') } },
        );
        c.obs.enum('crossTenant', classOf(r.status));
      },
    ),
    sc(
      'contacts.update.patch',
      'PATCH is not the same route in Reference',
      ['contacts', 'update', 'routing'],
      async (c) => {
        const d0 = await withContact(c);
        const r = await call(c, 'PATCH', `/contacts/${d0.id}`, {
          key: await getKey(c),
          body: { name: c.tag('patched') },
        });
        rec(c, r);
      },
    ),
    sc(
      'contacts.update.twice-quickly',
      'two concurrent updates',
      ['contacts', 'update', 'concurrency'],
      async (c) => {
        const d0 = await withContact(c);
        const k = await getKey(c);
        const [a, b] = await Promise.all([
          call(c, 'PUT', `/contacts/${d0.id}`, { key: k, body: { name: c.tag('conc-a') } }),
          call(c, 'PUT', `/contacts/${d0.id}`, { key: k, body: { name: c.tag('conc-b') } }),
        ]);
        c.obs.set('set.statuses', [classOf(a.status), classOf(b.status)]);
        c.obs.flag('noConflictSeenByClient', a.status !== 409 && b.status !== 409);
      },
    ),
    sc(
      'contacts.delete.valid',
      'delete a contact, then it is gone',
      ['contacts', 'delete', 'happy'],
      async (c) => {
        const d0 = await withContact(c);
        const k = await getKey(c);
        const r = await call(c, 'DELETE', `/contacts/${d0.id}`, { key: k });
        rec(c, r);
        c.obs.set('set.deleteKeys', keysOf(r.json?.data));
        c.obs.flag('deletedTrue', r.json?.data?.deleted === true);
        c.obs.flag('echoesId', r.json?.data?.id === d0.id);
        const g = await call(c, 'GET', `/contacts/${d0.id}`, { key: k });
        c.obs.set('status.afterDelete', classOf(g.status));
        const again = await call(c, 'DELETE', `/contacts/${d0.id}`, { key: k });
        c.obs.set('status.deleteTwice', classOf(again.status));
      },
    ),
    sc(
      'contacts.delete.unknown',
      'delete an id that does not exist',
      ['contacts', 'delete', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'DELETE',
            `/contacts/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c) },
          ),
        );
      },
    ),
    sc(
      'contacts.delete.foreign',
      'delete a record of another workspace',
      ['contacts', 'delete', 'tenant'],
      async (c) => {
        const r = await call(
          c,
          'DELETE',
          `/contacts/${c.side === 'threadwise' ? '1' : 'ffffffff-ffff-4fff-8fff-ffffffffffff'}`,
          { key: await getKey(c) },
        );
        c.obs.enum('crossTenant', classOf(r.status));
      },
    ),
    sc(
      'contacts.delete.removes-from-group-count',
      'deleting a contact lowers its group count',
      ['contacts', 'delete', 'groups'],
      async (c) => {
        const g = await createGroup(c, { name: c.tag('cnt') });
        const gid = g.json?.data?.id;
        const d0 = await withContact(c, { group_ids: [gid] });
        const k = await getKey(c);
        const count = async () =>
          ((await call(c, 'GET', '/contact-groups', { key: k })).json?.data || []).find(
            (x) => x.id === gid,
          )?.contacts_count;
        c.obs.num('countBefore', await count());
        await call(c, 'DELETE', `/contacts/${d0.id}`, { key: k });
        c.obs.num('countAfter', await count());
      },
    ),
  );

  // ---- H. contact groups ---------------------------------------------------------------------------------------
  const groupCase = (id, title, mut, tags = []) =>
    sc(
      `groups.create.${id}`,
      `create group, ${title}`,
      ['groups', 'validation', ...tags],
      async (c) => {
        const body = typeof mut === 'function' ? mut(c) : { name: c.tag('grp'), ...mut };
        const r = await createGroup(c, body);
        rec(c, r);
        const d = r.json?.data;
        c.obs.flag('accepted', ok2xx(r));
        if (d) {
          c.obs.set('set.groupKeys', keysOf(d));
          c.obs.enum('idStyle', idStyle(d.id));
          c.obs.num('contactsCount', d.contacts_count ?? null);
          c.obs.enum('colorStored', d.color == null ? 'null' : String(d.color).toLowerCase());
          c.obs.enum('noteStored', d.note == null ? 'null' : 'text');
        }
      },
    );
  scenarios.push(
    groupCase('valid', 'name, note and hex colour', { note: 'a note', color: '#7C3AED' }, [
      'happy',
    ]),
    groupCase('name-only', 'name only', {}),
    groupCase('missing-name', 'no name', { name: undefined }, ['required']),
    groupCase('name-empty', 'empty name', { name: '' }, ['required']),
    groupCase('name-spaces', 'name only spaces', { name: '    ' }, ['required']),
    groupCase('name-191', 'name at 191', (c) => ({ name: pad(c.tag('g191') + '-', 191) })),
    groupCase('name-192', 'name over 191', (c) => ({ name: pad(c.tag('g192') + '-', 192) })),
    groupCase('name-unicode', 'unicode name', (c) => ({ name: `${c.tag('gu')} 李雷 🎉` })),
    groupCase('name-html', 'markup in the name', (c) => ({ name: `${c.tag('gh')} <b>x</b>` })),
    groupCase('name-number', 'name as a number', { name: 12345 }),
    groupCase('note-500', 'note at 500', { note: 'n'.repeat(500) }),
    groupCase('note-501', 'note over 500', { note: 'n'.repeat(501) }),
    groupCase('color-named', 'colour "red" (not hex)', { color: 'red' }),
    groupCase('color-hex3', 'colour #abc', { color: '#abc' }),
    groupCase('color-hex8', 'colour with alpha', { color: '#7C3AEDff' }),
    groupCase('color-32', 'colour string of 32 characters', { color: '#' + 'a'.repeat(31) }),
    groupCase('color-33', 'colour string of 33 characters', { color: '#' + 'a'.repeat(32) }),
    groupCase('color-null', 'colour null', { color: null }),
    sc(
      'groups.create.duplicate-name',
      'the same name twice (also in another case)',
      ['groups', 'unique'],
      async (c) => {
        const name = c.tag('gdup');
        const a = await createGroup(c, { name });
        const b = await createGroup(c, { name });
        const d = await createGroup(c, { name: name.toUpperCase() });
        c.obs.flag('firstAccepted', ok2xx(a));
        rec(c, b);
        c.obs.flag('secondIsNewRow', b.status === 201 && b.json?.meta?.existing !== true);
        c.obs.flag('sameIdReturned', a.json?.data?.id === b.json?.data?.id);
        c.obs.set('status.upperCaseTwin', classOf(d.status));
        c.obs.flag('upperCaseIsNewRow', d.status === 201 && d.json?.meta?.existing !== true);
      },
    ),
    sc('groups.list.shape', 'list groups', ['groups', 'list', 'happy'], async (c) => {
      const g = await createGroup(c, { name: c.tag('glist'), note: 'x', color: '#112233' });
      const r = await call(c, 'GET', '/contact-groups', { key: await getKey(c) });
      rec(c, r);
      c.obs.flag('dataIsArray', Array.isArray(r.json?.data));
      c.obs.set('set.metaKeys', keysOf(r.json?.meta));
      c.obs.set('set.groupKeys', keysOf((r.json?.data || [])[0]));
      c.obs.flag('metaCountMatches', r.json?.meta?.count === (r.json?.data || []).length);
      c.obs.flag(
        'containsCreated',
        (r.json?.data || []).some((x) => x.id === g.json?.data?.id),
      );
      c.obs.flag('newestFirst', (r.json?.data || [])[0]?.id === g.json?.data?.id);
    }),
    sc(
      'groups.list.not-paged',
      'list ignores paging parameters',
      ['groups', 'list', 'pagination'],
      async (c) => {
        const k = await getKey(c);
        await createGroup(c, { name: c.tag('gp1') });
        await createGroup(c, { name: c.tag('gp2') });
        const r = await call(c, 'GET', '/contact-groups', {
          key: k,
          query: { per_page: '1', limit: '1' },
        });
        rec(c, r);
        c.obs.flag('allReturnedDespitePaging', (r.json?.data || []).length >= 2);
      },
    ),
    sc(
      'groups.delete.valid',
      'delete a group detaches its contacts',
      ['groups', 'delete', 'happy'],
      async (c) => {
        const g = await createGroup(c, { name: c.tag('gdel') });
        const gid = g.json?.data?.id;
        const d0 = await withContact(c, { group_ids: [gid] });
        const k = await getKey(c);
        const r = await call(c, 'DELETE', `/contact-groups/${gid}`, { key: k });
        rec(c, r);
        c.obs.set('set.deleteKeys', keysOf(r.json?.data));
        const after = await call(c, 'GET', `/contacts/${d0.id}`, { key: k });
        c.obs.flag('contactKept', ok2xx(after));
        c.obs.num('tagsAfterGroupDelete', after.json?.data?.tags?.length ?? -1);
        c.obs.set(
          'status.deleteTwice',
          classOf((await call(c, 'DELETE', `/contact-groups/${gid}`, { key: k })).status),
        );
      },
    ),
    sc(
      'groups.delete.unknown',
      'delete a group that does not exist',
      ['groups', 'delete', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'DELETE',
            `/contact-groups/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c) },
          ),
        );
      },
    ),
    sc(
      'groups.delete.foreign',
      'delete a group of another workspace',
      ['groups', 'delete', 'tenant'],
      async (c) => {
        const r = await call(
          c,
          'DELETE',
          `/contact-groups/${c.side === 'threadwise' ? '1' : 'ffffffff-ffff-4fff-8fff-ffffffffffff'}`,
          { key: await getKey(c) },
        );
        c.obs.enum('crossTenant', classOf(r.status));
      },
    ),
  );

  // ---- I. deals (plan gate, then CRUD when the plan allows it) -------------------------------------------------
  const dealsOpen = async (c) => {
    if (!DEAL_GATE[c.side]) {
      const r = await call(c, 'GET', '/deals', { key: await getKey(c) });
      DEAL_GATE[c.side] = { open: ok2xx(r), status: r.status, code: errorCode(r) };
    }
    return DEAL_GATE[c.side];
  };
  const dealBody = (c, over = {}) => ({ title: c.tag('deal'), ...over });
  async function createDeal(c, body) {
    const r = await call(c, 'POST', '/deals', { key: await getKey(c), body });
    const d = r.json?.data;
    if (r.status === 201 && d?.id != null) c.onCleanup(() => delOwned(c, `/deals/${d.id}`, d));
    return r;
  }
  const dealScenario = (id, title, tags, fn) =>
    sc(`deals.${id}`, `deals, ${title}`, ['deals', ...tags], async (c) => {
      const gate = await dealsOpen(c);
      c.obs.flag('planAllowsDeals', gate.open);
      if (!gate.open) {
        rec(c, {
          status: gate.status,
          json: { error: { code: gate.code } },
          headers: {},
          text: '',
        });
        return;
      }
      await fn(c);
    });
  scenarios.push(
    sc(
      'deals.plan-gate',
      'plan gate: every deals route, with a bad body and an unknown id',
      ['deals', 'plan'],
      async (c) => {
        const k = await getKey(c);
        const gate = await dealsOpen(c);
        c.obs.flag('planAllowsDeals', gate.open);
        if (!gate.open) {
          // the gate is checked before validation and before any lookup
          rec(c, await call(c, 'POST', '/deals', { key: k, body: {} }), 'create_bad_body');
          rec(
            c,
            await call(
              c,
              'GET',
              `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
              { key: k },
            ),
            'show_unknown',
          );
          rec(
            c,
            await call(
              c,
              'PUT',
              `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
              { key: k, body: {} },
            ),
            'update_unknown',
          );
          rec(
            c,
            await call(
              c,
              'DELETE',
              `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
              { key: k },
            ),
            'delete_unknown',
          );
          rec(c, await call(c, 'GET', '/deals', { key: k }), 'list');
        }
      },
    ),
    dealScenario('create.valid', 'create with title only', ['create', 'happy'], async (c) => {
      const r = await createDeal(c, dealBody(c));
      rec(c, r);
      const d = r.json?.data;
      c.obs.set('set.dealKeys', keysOf(d));
      c.obs.enum('status', d?.status);
      c.obs.enum('source', d?.source);
      c.obs.num('valueMinor', d?.value_minor);
      c.obs.enum('idStyle', idStyle(d?.id));
      c.obs.flag('hasStage', !!d?.stage);
      c.obs.flag('envelopeHasNoMeta', r.json?.meta === undefined);
    }),
    ...[
      ['title-missing', {}, null],
      ['title-empty', { title: '' }, null],
      ['title-191', null, (c) => ({ title: pad(c.tag('d191') + '-', 191) })],
      ['title-192', null, (c) => ({ title: pad(c.tag('d192') + '-', 192) })],
      ['value-negative', { value: -1 }, null],
      ['value-max', { value: 99999999 }, null],
      ['value-over', { value: 100000000 }, null],
      ['value-text', { value: 'abc' }, null],
      ['value-decimal', { value: 12.345 }, null],
      ['value-string-number', { value: '12.50' }, null],
      ['value-null', { value: null }, null],
      ['currency-lower', { currency: 'usd' }, null],
      ['currency-long', { currency: 'x'.repeat(11) }, null],
      ['currency-four', { currency: 'USDX' }, null],
      ['date-bad', { expected_close_date: 'not-a-date' }, null],
      ['date-ok', { expected_close_date: '2030-12-31' }, null],
      [
        'contact-unknown',
        null,
        (c) => ({
          contact_id: c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa',
        }),
      ],
      [
        'pipeline-unknown',
        null,
        (c) => ({
          pipeline_id: c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa',
        }),
      ],
      [
        'stage-unknown',
        null,
        (c) => ({
          stage_id: c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa',
        }),
      ],
      [
        'owner-foreign',
        null,
        (c) => ({
          owner_user_id: c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa',
        }),
      ],
      ['title-html', null, (c) => ({ title: `${c.tag('dh')} <script>alert(1)</script>` })],
      ['title-unicode', null, (c) => ({ title: `${c.tag('du')} 李雷 🎉` })],
    ].map(([id, over, fn]) =>
      dealScenario(`create.${id}`, `create, ${id}`, ['create', 'validation', 'edge'], async (c) => {
        const body = fn
          ? { ...dealBody(c), ...fn(c) }
          : id === 'title-missing'
            ? { ...over }
            : { ...dealBody(c), ...over };
        const r = await createDeal(c, body);
        rec(c, r);
        const d = r.json?.data;
        c.obs.flag('accepted', ok2xx(r));
        if (d) {
          c.obs.num('valueMinor', d.value_minor);
          c.obs.num('value', d.value);
          c.obs.enum('currency', d.currency);
          c.obs.enum('expectedClose', d.expected_close_date);
          c.obs.flag('contactLinked', d.contact_id != null);
          c.obs.flag('ownerSet', d.owner_user_id != null);
        }
      }),
    ),
    dealScenario('show.valid', 'show one', ['read', 'happy'], async (c) => {
      const r0 = await createDeal(c, dealBody(c, { value: 5 }));
      const r = await call(c, 'GET', `/deals/${r0.json?.data?.id}`, { key: await getKey(c) });
      rec(c, r);
      c.obs.flag('sameAsCreate', JSON.stringify(r.json?.data) === JSON.stringify(r0.json?.data));
    }),
    dealScenario('show.unknown', 'show an unknown id', ['read', 'edge'], async (c) => {
      rec(
        c,
        await call(
          c,
          'GET',
          `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
          { key: await getKey(c) },
        ),
      );
    }),
    dealScenario(
      'show.foreign',
      'show a deal of another workspace',
      ['read', 'tenant'],
      async (c) => {
        const r = await call(
          c,
          'GET',
          `/deals/${c.side === 'threadwise' ? '1' : 'ffffffff-ffff-4fff-8fff-ffffffffffff'}`,
          { key: await getKey(c) },
        );
        c.obs.enum('crossTenant', classOf(r.status));
      },
    ),
    dealScenario('list.shape', 'list shape and pagination clamp', ['list'], async (c) => {
      await createDeal(c, dealBody(c));
      await createDeal(c, dealBody(c));
      const k = await getKey(c);
      const r = await call(c, 'GET', '/deals', { key: k, query: { per_page: '1' } });
      rec(c, r);
      c.obs.num('itemsReturned', (r.json?.data || []).length);
      c.obs.set('set.metaKeys', keysOf(r.json?.meta));
      const big = await call(c, 'GET', '/deals', { key: k, query: { per_page: '1000' } });
      c.obs.num('pageSizeClamped', big.json?.meta?.limit ?? big.json?.meta?.per_page ?? null);
    }),
    dealScenario(
      'list.filters',
      'filters that match nothing are an empty list, not an error',
      ['list', 'edge'],
      async (c) => {
        const k = await getKey(c);
        rec(c, await call(c, 'GET', '/deals', { key: k, query: { status: 'nonsense' } }), 'status');
        rec(c, await call(c, 'GET', '/deals', { key: k, query: { stage_id: 'abc' } }), 'stage');
        rec(
          c,
          await call(c, 'GET', '/deals', { key: k, query: { pipeline_id: 'abc' } }),
          'pipeline',
        );
        const open = await call(c, 'GET', '/deals', { key: k, query: { status: 'open' } });
        c.obs.flag('openFilterWorks', ok2xx(open));
      },
    ),
    dealScenario('update.title', 'update the title', ['update', 'happy'], async (c) => {
      const r0 = await createDeal(c, dealBody(c));
      const r = await call(c, 'PUT', `/deals/${r0.json?.data?.id}`, {
        key: await getKey(c),
        body: { title: c.tag('deal-renamed') },
      });
      rec(c, r);
      c.obs.flag('titleChanged', r.json?.data?.title !== r0.json?.data?.title);
    }),
    dealScenario(
      'update.empty-title',
      'update with an empty title',
      ['update', 'validation'],
      async (c) => {
        const r0 = await createDeal(c, dealBody(c));
        rec(
          c,
          await call(c, 'PUT', `/deals/${r0.json?.data?.id}`, {
            key: await getKey(c),
            body: { title: '' },
          }),
        );
      },
    ),
    dealScenario('update.value-null', 'value null becomes zero', ['update', 'edge'], async (c) => {
      const r0 = await createDeal(c, dealBody(c, { value: 9 }));
      const r = await call(c, 'PUT', `/deals/${r0.json?.data?.id}`, {
        key: await getKey(c),
        body: { value: null },
      });
      rec(c, r);
      c.obs.num('valueMinorAfter', r.json?.data?.value_minor ?? null);
    }),
    dealScenario(
      'update.stage-valid',
      'move to another stage of the same pipeline',
      ['update', 'stage'],
      async (c) => {
        const r0 = await createDeal(c, dealBody(c));
        const d0 = r0.json?.data;
        // Reference has no stage listing in the API: read the next stage through a second deal created on the same pipeline
        // is not possible either, so the move is exercised with the stage the deal already has (a no-op) and with an unknown one.
        const k = await getKey(c);
        const same = await call(c, 'PUT', `/deals/${d0.id}`, {
          key: k,
          body: { stage_id: d0.stage_id },
        });
        rec(c, same, 'same_stage');
        c.obs.enum('statusAfterSameStage', same.json?.data?.status);
      },
    ),
    dealScenario(
      'update.stage-unknown',
      'move to a stage that is not in the pipeline',
      ['update', 'stage', 'validation'],
      async (c) => {
        const r0 = await createDeal(c, dealBody(c));
        rec(
          c,
          await call(c, 'PUT', `/deals/${r0.json?.data?.id}`, {
            key: await getKey(c),
            body: {
              stage_id: c.side === 'threadwise' ? 987654321 : '00000000-0000-4000-8000-0000000000aa',
            },
          }),
        );
      },
    ),
    dealScenario(
      'update.unknown-bad-body',
      'unknown id with an invalid body',
      ['update', 'edge'],
      async (c) => {
        rec(
          c,
          await call(
            c,
            'PUT',
            `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
            { key: await getKey(c), body: { title: '' } },
          ),
        );
      },
    ),
    dealScenario(
      'update.lost-reason-open',
      'lost_reason on an open deal',
      ['update', 'edge'],
      async (c) => {
        const r0 = await createDeal(c, dealBody(c));
        const r = await call(c, 'PUT', `/deals/${r0.json?.data?.id}`, {
          key: await getKey(c),
          body: { lost_reason: 'budget' },
        });
        rec(c, r);
        c.obs.enum('lostReasonAfter', r.json?.data?.lost_reason ?? 'null');
      },
    ),
    dealScenario('delete.valid', 'delete, then it is gone', ['delete', 'happy'], async (c) => {
      const r0 = await createDeal(c, dealBody(c));
      const id = r0.json?.data?.id;
      const k = await getKey(c);
      const r = await call(c, 'DELETE', `/deals/${id}`, { key: k });
      rec(c, r);
      c.obs.set('set.deleteKeys', keysOf(r.json?.data));
      c.obs.set(
        'status.afterDelete',
        classOf((await call(c, 'GET', `/deals/${id}`, { key: k })).status),
      );
      c.obs.set(
        'status.deleteTwice',
        classOf((await call(c, 'DELETE', `/deals/${id}`, { key: k })).status),
      );
    }),
    dealScenario('delete.unknown', 'delete an unknown id', ['delete', 'edge'], async (c) => {
      rec(
        c,
        await call(
          c,
          'DELETE',
          `/deals/${c.side === 'threadwise' ? '987654321' : '00000000-0000-4000-8000-0000000000aa'}`,
          { key: await getKey(c) },
        ),
      );
    }),
  );

  // ---- J. the key lifecycle (runs last: it revokes the shared key) --------------------------------------------
  scenarios.push(
    sc(
      'zz.auth.revoked-key',
      'a revoked key stops working at once',
      ['auth', 'lifecycle'],
      async (c) => {
        const k = await getKey(c);
        const before = await call(c, 'GET', '/me', { key: k });
        c.obs.set('status.beforeRevoke', classOf(before.status));
        await revokeKey(c, KEYS[c.side] && (await KEYS[c.side]));
        KEYS[c.side] = null; // the next scenario that needs a key mints a fresh one
        const after = await call(c, 'GET', '/me', { key: k });
        rec(c, after);
        const afterX = await call(c, 'GET', '/me', { key: k, xkey: true });
        c.obs.set('status.afterRevokeXKey', classOf(afterX.status));
        const afterWrite = await call(c, 'POST', '/contacts', {
          key: k,
          body: { name: 'x', phone: '+919999999999' },
        });
        c.obs.set('status.afterRevokeWrite', classOf(afterWrite.status));
      },
    ),
    sc(
      'zz.auth.new-key-after-revoke',
      'a new key works after the old one was revoked',
      ['auth', 'lifecycle'],
      async (c) => {
        const k2 = await getKey(c);
        const r = await call(c, 'GET', '/me', { key: k2 });
        rec(c, r);
      },
    ),
  );

  return {
    feature: 'TW-API-001',
    title:
      'Customer REST API /api/v1 with an API key (auth, envelopes, account, contacts, groups, deals)',
    scenarios,
    teardown: {
      threadwise: async (c) => {
        for (const s of SEEDS.threadwise ? await SEEDS.threadwise.catch(() => []) : [])
          await delOwned(c, `/contacts/${s.id}`, s).catch(() => {});
        if (KEYS.threadwise) await revokeKey(c, await KEYS.threadwise.catch(() => null));
      },
      ours: async (c) => {
        for (const s of SEEDS.ours ? await SEEDS.ours.catch(() => []) : [])
          await delOwned(c, `/contacts/${s.id}`, s).catch(() => {});
        if (KEYS.ours) await revokeKey(c, await KEYS.ours.catch(() => null));
      },
    },
    intended: [
      {
        key: 'enum.errorShape',
        quirk: 'TW-API-007 QUIRK 3',
        reason:
          'Reference answers validation, unknown routes and wrong methods with Laravel default bodies ({message, errors}); ours renders every failure under /api/v1 as { error: { code, message, details } } (inventory TW-API-007 port notes, docs/api section 4)',
      },
      {
        scenario: /^api\.(contacts|deals)\.list\.shape$/,
        key: 'set.metaKeys',
        reason:
          'cursor pagination: meta carries limit, next_cursor and has_more instead of page, per_page, total, last_page (docs/api section 4 Cursor pagination, TW-API-007 port notes)',
      },
      {
        key: 'enum.workspaceIdStyle',
        reason:
          'ids are uuids on our side, integers on Reference (CONTRIBUTING 4, docs/api section 1)',
      },
      {
        scenario: /^api\.contacts\.list\.(page-param|page-garbage|cursor-garbage)$/,
        key: /.*/,
        reason:
          'lists are paged by cursor: `page` is refused with 422 asking for the cursor and a cursor that was never issued is refused; Reference takes page numbers and ignores unknown parameters (docs/api section 4 Cursor pagination)',
      },
      {
        scenario: /^api\.contacts\.list\.limit-/,
        key: /^(num\.(itemsReturned|pageSizeInMeta)|status\.http|num\.httpStatus|set\.flaggedFields|enum\.errorCode)$/,
        reason:
          '`limit` is our primary page-size parameter (`per_page` is the Reference alias); Reference does not read `limit` at all (docs/api section 4)',
      },
      {
        scenario: /^api\.contacts\.list\.search-long-(201|1000)$/,
        key: /^(status\.http|num\.httpStatus|enum\.errorCode|set\.flaggedFields)$/,
        reason:
          'search is trimmed and limited to 200 characters; Reference has no limit (docs/api section 6, GET /contacts)',
      },
      {
        scenario: /^api\.contacts\.create\.duplicate-(phone|email)$/,
        reason:
          'a phone or email that already belongs to a contact answers that contact (201, meta.created false) instead of making a twin; identity matching is the dashboard service (docs/api section 6, POST /contacts "Difference from Reference")',
      },
      {
        scenario: /^api\.contacts\.create\.(phone-letters|phone-short|phone-32|country-code-10)$/,
        key: /^(flag\.accepted|enum\.outcome|status\.http|num\.httpStatus|enum\.errorCode|set\.flaggedFields|map\.stored|enum\.idStyle|set\.contactKeys)$/,
        reason:
          'phone is normalised to E.164 and a value that is not a number is 422 on phone; Reference stores any string up to 32 characters (docs/api section 6, POST /contacts)',
      },
      {
        scenario: /^api\.contacts\.create\.attributes-list$/,
        key: /^(flag\.accepted|enum\.outcome|status\.http|num\.httpStatus|enum\.errorCode|set\.flaggedFields|map\.stored|enum\.idStyle|set\.contactKeys)$/,
        reason:
          'attributes is a free-form key/value object in our contract; Reference validates only "array" and so also accepts a list (docs/api section 6, contact fields)',
      },
      {
        scenario: /^api\.groups\.create\.duplicate-name$/,
        reason:
          'a group name the workspace already has (compared ignoring case) answers that group with 200 and meta.existing instead of making a twin (docs/api section 6, POST /contact-groups "Difference from Reference")',
      },
      {
        scenario: /^api\.groups\.create\.color-(named|hex3|hex8|32|33)$/,
        key: /^(flag\.accepted|enum\.outcome|status\.http|num\.httpStatus|enum\.errorCode|set\.flaggedFields|set\.groupKeys|enum\.idStyle|num\.contactsCount|enum\.colorStored|enum\.noteStored)$/,
        reason:
          'color must be exactly #RRGGBB (database check constraint, so 3- and 8-digit hex are refused too); Reference took any string of up to 32 characters (docs/api section 6, POST /contact-groups)',
      },
      {
        scenario: 'api.usage.fields',
        key: /^(set\.dataKeys|enum\.creditsType)$/,
        reason:
          'credits is the wallet balance in minor units of `currency` as a string and `currency` is added; Reference answers a credit count (docs/api section 6, GET /usage "Difference from Reference"; TW-API-021 port notes)',
      },
      {
        scenario: /^api\.deals\.create\.currency-(lower|four)$/,
        key: /^(flag\.accepted|enum\.outcome|status\.http|num\.httpStatus|enum\.errorCode|set\.flaggedFields|enum\.currency|num\.valueMinor|num\.value|enum\.expectedClose|flag\.contactLinked|flag\.ownerSet)$/,
        reason:
          'deal currency is a three-letter code and is upper-cased; Reference stores any string up to 10 characters as typed (docs/api section 6, POST /deals)',
      },
      {
        scenario: /^api\.deals\.create\.owner-foreign$/,
        key: /^(flag\.accepted|enum\.outcome|status\.http|num\.httpStatus|enum\.errorCode)$/,
        reason:
          'an owner that is not a member of the workspace is refused (422); Reference stored any integer as the owner (docs/api section 6, POST /deals owner_user_id)',
      },
      {
        scenario: 'api.noauth.write-malformed-body',
        key: /^(status\.http|num\.httpStatus|enum\.errorCode)$/,
        reason:
          'platform rule: the JSON body parser runs before authentication, so unreadable JSON is 422 even without a key; Reference authenticates first (401). Accepted by the coordinator',
      },
    ],
    skip: [
      {
        scenario: /^api\.noauth\.lockout/,
        reason:
          'the failed-attempt lockout (30 failures per address per minute) would block the shared address for the rest of the run',
      },
    ],
  };
};
