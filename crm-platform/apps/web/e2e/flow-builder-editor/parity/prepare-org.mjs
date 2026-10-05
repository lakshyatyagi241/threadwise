// Makes (or reuses) the FLB demo organisation and writes the PARITY_CONFIG json the twin harness reads. Run:
//   API=http://localhost:53110 WEB=http://localhost:3110 node prepare-org.mjs /path/to/parity.json
// Stable demo login: workspace slug printed at the end, flb-demo@example.com / Str0ngPassw0rd#1.
// Needs docker with the dev Postgres (psql runs through `docker exec crm-postgres`; PSQL='["docker","exec","crm-postgres","psql","-U","crm","-d","crm_flb","-tAc"]' overrides).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:53110';
const WEB = process.env.WEB ?? 'http://localhost:3110';
const PSQL = JSON.parse(
  process.env.PSQL ?? '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_flb","-tAc"]',
);
const psql = (sql) => execFileSync(PSQL[0], [...PSQL.slice(1), sql], { encoding: 'utf8' }).trim();
const out = process.argv[2];
assert.ok(out, 'usage: node prepare-org.mjs <config.json>');

const EMAIL = process.env.FLB_EMAIL ?? 'flb-demo@example.com';
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

let login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
if (login.status >= 300) {
  const signup = await call('/auth/signup', null, 'POST', {
    orgName: 'Flow Builder Demo',
    fullName: 'Flow Demo',
    email: EMAIL,
    password: PASS,
    acceptTerms: true,
  });
  assert.equal(signup.status, 201, `signup ${signup.status}`);
  login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
  assert.ok(login.status < 300, `login ${login.status}`);
}
// Idempotent: a re-run after a half-finished first run still ends with onboarding complete.
const token = login.json.tokens.accessToken;
await call('/onboarding/workspace', token, 'POST', { name: 'Flow Builder Demo', timezone: 'UTC' });
await call('/onboarding/complete', token, 'POST', {});
const ORG = login.json.orgSlug;
psql(
  `UPDATE org_plan_state SET overrides = '{"features":{"automation":true}}'::jsonb WHERE org_id = (SELECT id FROM organizations WHERE slug = '${ORG}')`,
);
// The twin spec compares pickers against the reference workspace, which has these contact tags: seed the same names (idempotent).
for (const name of ['Customer', 'Follow Up', 'Interested', 'New Lead', 'Not Interested', 'VIP'])
  await call('/tags', token, 'POST', { name, color: '#075E54' }); // a duplicate name answers 4xx, which is fine
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
console.log(`org ${ORG} (${EMAIL} / ${PASS}) -> ${out}`);
