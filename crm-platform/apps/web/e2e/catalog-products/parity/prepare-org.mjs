// Makes a throw-away organisation for a TW-CAT twin run (no device, no catalog connection, wa_storefront on) and writes the
// PARITY_CONFIG json the harness reads. Run:  node prepare-org.mjs /path/to/parity.json
//   API=http://localhost:53108 WEB=http://localhost:3108 node prepare-org.mjs out.json
// Needs docker with the dev Postgres (psql runs through `docker exec crm-postgres`; PSQL='["psql","-U","crm","-d","crm_cat","-tAc"]' overrides).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:53108';
const WEB = process.env.WEB ?? 'http://localhost:3108';
const PSQL = JSON.parse(
  process.env.PSQL ?? '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_cat","-tAc"]',
);
const psql = (sql) => execFileSync(PSQL[0], [...PSQL.slice(1), sql], { encoding: 'utf8' }).trim();
const out = process.argv[2];
assert.ok(out, 'usage: node prepare-org.mjs <config.json>');

const STAMP = Date.now();
const EMAIL = `cat-twin-${STAMP}@example.com`;
const PASS = 'Str0ngPassw0rd#1';
const call = async (path, token, method = 'GET', body) => {
  const res = await fetch(`${API}/v2${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const signup = await call('/auth/signup', null, 'POST', {
  orgName: `Cat Twin ${STAMP}`,
  fullName: 'Cat Twin',
  email: EMAIL,
  password: PASS,
  acceptTerms: true,
});
assert.equal(signup.status, 201, `signup ${signup.status}`);
const login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
const token = login.json.tokens.accessToken;
const ORG = login.json.orgSlug;
await call('/onboarding/workspace', token, 'POST', { name: `Cat Twin ${STAMP}`, timezone: 'UTC' });
assert.ok((await call('/onboarding/complete', token, 'POST', {})).status < 300);
psql(
  `UPDATE org_plan_state SET overrides = '{"features":{"wa_storefront":true}}'::jsonb WHERE org_id = (SELECT id FROM organizations WHERE slug = '${ORG}')`,
);
writeFileSync(
  out,
  JSON.stringify(
    {
      ours: {
        webUrl: WEB,
        apiUrl: API,
        org: ORG,
        apiLoginPath: '/v2/auth/login',
        users: { admin: { email: EMAIL, password: PASS } },
      },
      timeouts: { scenario: 200000 },
    },
    null,
    2,
  ),
);
console.log(`org ${ORG} (${EMAIL}) -> ${out}`);
