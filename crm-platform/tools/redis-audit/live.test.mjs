import test from 'node:test';
import assert from 'node:assert/strict';
import { checkVerdict, familyOf, ownerOf, summarize } from './live.mjs';

test('familyOf strips the prefix and turns value segments into *', () => {
  assert.equal(familyOf('qa-1:auth:gate:a.b@x.test', 'qa-1:'), 'auth:gate:*');
  assert.equal(familyOf('auth:ipfail:42:10.0.0.1'), 'auth:ipfail:*:*');
  assert.equal(familyOf('lock:123e4567-e89b-12d3-a456-426614174000'), 'lock:*');
  assert.equal(familyOf('form:pub:ip:deadbeefcafe'), 'form:pub:ip:*');
});
test('familyOf groups BullMQ keys by queue part, not by queue or job id', () => {
  assert.equal(familyOf('bull:inbox-send:wait'), 'bull:*:wait');
  assert.equal(familyOf('bull:inbox-send:1234'), 'bull:*:*');
  assert.equal(familyOf('bull:inbox-send:stalled-check'), 'bull:*:stalled-check');
});
test('a family that only starts with the letters bull is not a BullMQ family', () => {
  assert.equal(familyOf('bulletin:board:7'), 'bulletin:board:*');
});
test('ownerOf matches a glob and returns null when no owner is named', () => {
  const owners = [{ family: 'bull:*:*', owner: 'queues', reason: 'job state' }];
  assert.equal(ownerOf('bull:*:wait', owners)?.owner, 'queues');
  assert.equal(ownerOf('auth:gate:*', owners), null);
});
test('summarize: a family whose keys all expire is ttl; one that never expires is owned or UNOWNED', () => {
  const rows = [
    { key: 'auth:gate:a@b.c', type: 'string', ttl: 30, bytes: 60 },
    { key: 'auth:gate:d@e.f', type: 'string', ttl: 20, bytes: 80 },
    { key: 'bull:q:wait', type: 'list', ttl: -1, bytes: 100 },
    { key: 'stray:thing', type: 'string', ttl: -1, bytes: 50 },
  ];
  const s = summarize(rows, [{ family: 'bull:*:*', owner: 'queues', reason: 'job state' }]);
  const by = Object.fromEntries(s.families.map((f) => [f.family, f]));
  assert.equal(by['auth:gate:*'].status, 'ttl');
  assert.equal(by['auth:gate:*'].avgBytes, 70);
  assert.equal(by['bull:*:wait'].status, 'owned');
  assert.equal(by['stray:thing'].status, 'UNOWNED');
  assert.equal(s.totals.keysNoTtl, 2);
  assert.equal(s.totals.familiesUnowned, 1);
});

test('--check fails on an empty scan and on an unowned family, and passes otherwise', () => {
  assert.match(checkVerdict({ keys: 0, familiesUnowned: 0 }), /NO KEYS/);
  assert.match(checkVerdict({ keys: 5, familiesUnowned: 1 }), /no named owner/);
  assert.equal(checkVerdict({ keys: 5, familiesUnowned: 0 }), null);
});
