'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuality, wabaCredentials, fetchQualities } = require('./quality.cjs');

test('a rating is stored as Meta words it, uppercase; anything else is UNKNOWN', () => {
  assert.equal(normalizeQuality('GREEN'), 'GREEN');
  assert.equal(normalizeQuality({ score: 'yellow' }), 'YELLOW');
  assert.equal(normalizeQuality({ score: 'RED' }), 'RED');
  assert.equal(normalizeQuality('HIGH'), 'GREEN');
  assert.equal(normalizeQuality({ score: 'medium' }), 'YELLOW');
  assert.equal(normalizeQuality({ score: 'LOW' }), 'RED');
  assert.equal(normalizeQuality(null), 'UNKNOWN');
  assert.equal(normalizeQuality({ score: 'SOMETHING_NEW' }), 'UNKNOWN');
  assert.equal(normalizeQuality(undefined), 'UNKNOWN');
});

test('only live configs with a token and a WABA id count; one entry per WABA', () => {
  const docs = [
    { is_active: true, config_value: { access_token: 'T1', waba_id: '1234567890' } },
    { is_active: true, config_value: { access_token: 'T1', waba_id: '1234567890', phoneID: '2' } },
    { is_active: false, config_value: { access_token: 'T9', waba_id: '9999999999' } },
    { is_active: true, deleted_time: '2026-01-01', config_value: { access_token: 'T8', waba_id: '8888888888' } },
    { is_active: true, config_value: { waba_id: '7777777777' } },
    { is_active: true, config_value: { access_token: 'T6' } },
    { is_active: true, is_json: true, config_value: JSON.stringify({ access_token: 'T5', waba_id: '5555555555' }) },
  ];
  const { creds, skipped } = wabaCredentials(docs);
  assert.deepEqual(creds, [
    { wabaId: '1234567890', accessToken: 'T1' },
    { wabaId: '5555555555', accessToken: 'T5' },
  ]);
  assert.deepEqual(skipped, { inactive: 2, incomplete: 2 });
});

test('paging follows paging.next and the token travels only in the header', async () => {
  const seen = [];
  const pages = [
    {
      data: [{ name: 'a', language: 'en', quality_score: { score: 'GREEN' } }],
      paging: { next: 'https://graph.facebook.com/v25.0/1/message_templates?after=x' },
    },
    { data: [{ name: 'b', language: 'en_GB', quality_score: null }] },
  ];
  const fake = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    return { ok: true, status: 200, json: async () => pages[seen.length - 1] };
  };
  const rows = await fetchQualities({ wabaId: '1', accessToken: 'SECRET' }, fake);
  assert.deepEqual(rows, [
    { name: 'a', language: 'en', quality: 'GREEN' },
    { name: 'b', language: 'en_GB', quality: 'UNKNOWN' },
  ]);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.auth === 'Bearer SECRET'));
  assert.ok(seen.every((s) => !s.url.includes('SECRET')));
});

test('a refused WABA fails without the token in the message', async () => {
  const refused = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(
    fetchQualities({ wabaId: '1', accessToken: 'SECRET' }, refused),
    (e) => /401/.test(e.message) && !e.message.includes('SECRET'),
  );
});
