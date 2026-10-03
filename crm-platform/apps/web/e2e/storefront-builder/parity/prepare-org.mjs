// Makes an organisation for a WD-STORE run: wa_storefront on, one connected WhatsApp device (the wizard refuses to save a shop
// without a sender) and, with --shop, one shop plus a few products. Writes the PARITY_CONFIG json the twin harness reads.
//   API=http://localhost:53109 WEB=http://localhost:3109 node prepare-org.mjs out.json [--shop] [--email store-dev@example.com]
// Needs docker with the dev Postgres (psql through `docker exec crm-postgres`; PSQL='["docker","exec","crm-postgres","psql","-U","crm","-d","crm_store","-tAc"]' overrides).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:53109';
const WEB = process.env.WEB ?? 'http://localhost:3109';
const PSQL = JSON.parse(
  process.env.PSQL ?? '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_store","-tAc"]',
);
const psql = (sql) => execFileSync(PSQL[0], [...PSQL.slice(1), sql], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const out = args.find((a) => a.endsWith('.json'));
const withShop = args.includes('--shop');
const emailArg = args.indexOf('--email');

const STAMP = Date.now();
const EMAIL = emailArg >= 0 ? args[emailArg + 1] : `store-twin-${STAMP}@example.com`;
const PASS = 'Str0ngPassw0rd#1';
const call = async (path, token, method = 'GET', body) => {
  const res = await fetch(`${API}/v2${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const signup = await call('/auth/signup', null, 'POST', {
  orgName: `Store Twin ${STAMP}`,
  fullName: 'Store Twin',
  email: EMAIL,
  password: PASS,
  acceptTerms: true,
});
assert.equal(signup.status, 201, `signup ${signup.status}`);
const login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
const token = login.json.tokens.accessToken;
const ORG = login.json.orgSlug;
await call('/onboarding/workspace', token, 'POST', { name: `Store Twin ${STAMP}`, timezone: 'UTC' });
assert.ok((await call('/onboarding/complete', token, 'POST', {})).status < 300);
const orgSql = `(SELECT id FROM organizations WHERE slug = '${ORG}')`;
psql(
  `UPDATE org_plan_state SET overrides = '{"features":{"wa_storefront":true}}'::jsonb WHERE org_id = ${orgSql}`,
);
psql(
  `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES (${orgSql}, 'Store Twin Phone', '91', '9810411122', 'connected', true)`,
);
if (withShop) {
  const shop = await call('/store/shops', token, 'POST', { shopName: `Store Twin ${STAMP}` });
  assert.equal(shop.status, 201, `shop ${shop.status} ${JSON.stringify(shop.json)}`);
  for (const [i, name] of ['Linen Shirt', 'Clay Mug', 'Canvas Tote'].entries()) {
    const p = await call('/catalog/products', token, 'POST', {
      name: `${name} ${STAMP}`,
      sku: `ST-${STAMP}-${i}`,
      priceMajor: String(499 + i * 250),
      currencyCode: 'INR',
      status: 'active',
    });
    assert.ok(p.status < 300, `product ${p.status} ${JSON.stringify(p.json)}`);
  }
}
if (out) {
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
}
console.log(`org ${ORG} (${EMAIL} / ${PASS})${out ? ` -> ${out}` : ''}`);
