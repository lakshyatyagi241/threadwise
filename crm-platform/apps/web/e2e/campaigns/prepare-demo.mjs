// Makes (or reuses) the broadcast-wizard demo workspace: a connected Cloud API number (the sandbox sender, CAMP_PROVIDER_MODE=fixture),
// approved templates, contacts in groups and a segment (some opted out, some with a bad number), and a funded pay-per-message wallet. Run:
//   API=http://localhost:53114 node apps/web/e2e/campaigns/prepare-demo.mjs
// Stable login printed at the end. Needs docker with the dev Postgres (psql through `docker exec crm-postgres`; PSQL overrides).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:53114';
const PSQL = JSON.parse(
  process.env.PSQL ?? '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_bcw","-tAc"]',
);
const psql = (q) => execFileSync(PSQL[0], [...PSQL.slice(1), q], { encoding: 'utf8' }).trim();
const EMAIL = process.env.DEMO_EMAIL ?? 'bcast-demo@example.com';
const PASS = 'Str0ngPassw0rd#1';
const call = async (path, token, method = 'GET', body) => {
  const res = await fetch(`${API}/v2${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
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
    orgName: 'Broadcast Demo',
    fullName: 'Asha Demo',
    email: EMAIL,
    password: PASS,
    acceptTerms: true,
  });
  assert.equal(signup.status, 201, `signup ${signup.status}`);
  login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
  assert.ok(login.status < 300, `login ${login.status}`);
}
const token = login.json.tokens.accessToken;
await call('/onboarding/workspace', token, 'POST', {
  name: 'Broadcast Demo',
  timezone: 'Asia/Kolkata',
});
await call('/onboarding/complete', token, 'POST', {});
const SLUG = login.json.orgSlug;
const org = psql(`SELECT id FROM organizations WHERE slug = '${SLUG}'`);

// A connected Cloud API number and approved templates (idempotent: only when there is none).
if (psql(`SELECT count(*) FROM wa_provider_configs WHERE org_id = ${org}`) === '0') {
  psql(`INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, is_primary, connected_at)
        VALUES (${org}, 'waba', 'connected', '+919000000001', 'Acme Support', true, now())`);
  const cfg = psql(`SELECT id FROM wa_provider_configs WHERE org_id = ${org} LIMIT 1`);
  const tpl = (name, lang, cat, header, body, footer, buttons, map) =>
    psql(`INSERT INTO wa_templates (org_id, template_name, language, category, meta_category, template_type, status, header, template_body, footer, buttons, variable_map, provider_config_id)
          VALUES (${org}, '${name}', '${lang}', '${cat}', '${cat}', 'standard', 'approved', ${header ? `'${header}'` : 'NULL'}, '${body}', ${footer ? `'${footer}'` : 'NULL'},
                  '${JSON.stringify(buttons)}'::jsonb, '${JSON.stringify(map)}'::jsonb, ${cfg})`);
  tpl(
    'diwali_offer',
    'en_US',
    'marketing',
    'Diwali offer for {{1}}',
    'Hi {{1}}, enjoy {{2}} off your next order at Acme. Offer ends this Sunday.',
    'Reply STOP to opt out',
    [
      {
        type: 'url',
        text: 'Shop now',
        url: 'https://acme.example/shop/{{1}}',
        example: ['https://acme.example/shop/diwali'],
      },
      { type: 'quick_reply', text: 'Not interested' },
    ],
    {
      header: [{ num: 1, key: 'first_name', example: 'Asha' }],
      body: [
        { num: 1, key: 'first_name', example: 'Asha' },
        { num: 2, key: '', example: '20%' },
      ],
    },
  );
  tpl(
    'order_update',
    'en_US',
    'utility',
    null,
    'Hi {{1}}, your order {{2}} is on its way.',
    null,
    [],
    {
      body: [
        { num: 1, key: 'first_name', example: 'Asha' },
        { num: 2, key: 'order_id', example: 'A-1042' },
      ],
    },
  );
  tpl(
    'welcome_hindi',
    'hi_IN',
    'marketing',
    null,
    'नमस्ते {{1}}, Acme में आपका स्वागत है।',
    null,
    [],
    { body: [{ num: 1, key: 'first_name', example: 'आशा' }] },
  );
  tpl(
    'store_hours',
    'en_US',
    'utility',
    null,
    'We are open 9 to 6, Monday to Saturday.',
    null,
    [],
    {},
  );
  psql(`INSERT INTO wa_templates (org_id, template_name, language, category, meta_category, template_type, status, template_body)
        VALUES (${org}, 'pending_review', 'en_US', 'marketing', 'marketing', 'standard', 'pending', 'Still in review {{1}}')`);
}

// Contacts: Indian, UK and US numbers, a few opted out, a few unusable.
if (psql(`SELECT count(*) FROM contacts WHERE org_id = ${org}`) === '0') {
  const first = [
    'Aarav',
    'Priya',
    'Rohan',
    'Isha',
    'Kabir',
    'Meera',
    'Vikram',
    'Anaya',
    'Dev',
    'Sana',
    'Arjun',
    'Diya',
    'Kiran',
    'Neha',
    'Rahul',
    'Tara',
    'Yash',
    'Zoya',
    'Om',
    'Riya',
  ];
  const rows = [];
  first.forEach((n, i) => {
    const n8 = String(10000000 + i * 1370137).slice(0, 8);
    const region = i % 5 === 3 ? 'UK' : i % 7 === 6 ? 'US' : 'IN';
    const country = [region === 'UK' ? '+44' : region === 'US' ? '+1' : '+91'];
    const phone =
      region === 'UK' ? `+4477${n8}` : region === 'US' ? `+1415${n8.slice(0, 7)}` : `+9198${n8}`;
    const city = ['Pune', 'Mumbai', 'Delhi', 'Bengaluru'][i % 4];
    rows.push(
      `(${org}, '${n} Sharma', '${n}', '${phone}', '${country[0]}', ${i % 9 === 8}, '{"city":"${city}","tier":"${i % 3 === 0 ? 'Gold' : 'Silver'}"}'::jsonb, now() - interval '${i * 9} days')`,
    );
  });
  rows.push(
    `(${org}, 'No Number', 'Nora', NULL, '+91', false, '{}'::jsonb, now())`,
    `(${org}, 'Bad Number', 'Bela', '12345', '+91', false, '{}'::jsonb, now())`,
  );
  // The sandbox answers by the last digits: ...1049 is refused for frequency capping once, ...0000 is undeliverable.
  rows.push(
    `(${org}, 'Capped Chitra', 'Chitra', '+919800001049', '+91', false, '{"city":"Pune","tier":"Gold"}'::jsonb, now())`,
    `(${org}, 'Dead Dinesh', 'Dinesh', '+919800000000', '+91', false, '{"city":"Delhi","tier":"Silver"}'::jsonb, now())`,
  );
  psql(
    `INSERT INTO contacts (org_id, name, first_name, phone, country_code, is_unsubscribed, data, created_at) VALUES ${rows.join(',')}`,
  );
  psql(
    `INSERT INTO contact_groups (org_id, name, color) VALUES (${org}, 'VIP customers', '#7C3AED'), (${org}, 'Pune customers', '#0EA5E9'), (${org}, 'Newsletter', '#16A34A')`,
  );
  psql(`INSERT INTO contact_group_members (org_id, group_id, contact_id)
        SELECT ${org}, g.id, c.id FROM contact_groups g JOIN contacts c ON c.org_id = g.org_id
        WHERE g.org_id = ${org} AND ((g.name = 'VIP customers' AND c.data->>'tier' = 'Gold')
           OR (g.name = 'Pune customers' AND c.data->>'city' = 'Pune') OR (g.name = 'Newsletter' AND c.id % 2 = 0))`);
  const seg = await call('/segments', token, 'POST', {
    name: 'Recently added',
    visibility: 'shared',
    rules: {
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'createdAt', operator: 'in_last_days', value: 60 }],
    },
  });
  assert.ok(seg.status < 300, `segment ${seg.status} ${JSON.stringify(seg.json)}`);
}

// Enough contacts to page through (the audience step's contacts table): top the workspace up to 150 with generated people. Idempotent.
if (Number(psql(`SELECT count(*) FROM contacts WHERE org_id = ${org}`)) < 150) {
  psql(`INSERT INTO contacts (org_id, name, first_name, last_name, email, phone, country_code, is_unsubscribed, data, created_at)
        SELECT ${org}, f.n || ' ' || l.n, f.n, l.n, lower(f.n || '.' || l.n || g) || '@example.com',
               '+9199' || lpad((7000000 + g * 7919)::text, 8, '0'), '+91', g % 23 = 0,
               jsonb_build_object('city', (ARRAY['Pune','Mumbai','Delhi','Bengaluru'])[1 + g % 4], 'tier', CASE WHEN g % 3 = 0 THEN 'Gold' ELSE 'Silver' END),
               now() - (g || ' hours')::interval
        FROM generate_series(1, 126) g,
             LATERAL (SELECT (ARRAY['Aditi','Bhavya','Chirag','Darshan','Esha','Farhan','Gauri','Harsh','Ira','Jai','Komal','Lakshya','Mohit','Nandini','Pranav','Qasim','Ritika','Sameer','Trisha','Uday'])[1 + g % 20] AS n) f,
             LATERAL (SELECT (ARRAY['Iyer','Kapoor','Mehta','Nair','Patel','Reddy','Singh','Verma','Bose','Joshi','Menon'])[1 + g % 11] AS n) l`);
}

// Pay per message, funded (hundredths of a dollar).
psql(
  `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES (${org}, true) ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = true`,
);
if (psql(`SELECT count(*) FROM wallets WHERE org_id = ${org}`) === '0') {
  psql(`INSERT INTO wallets (org_id, unit, balance) VALUES (${org}, 'USD', 25.0000)`);
}
console.log(`workspace ${SLUG}  login ${EMAIL} / ${PASS}`);
