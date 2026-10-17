// Tests for the transaction I/O detector (QA task 46). Run: node --test tools/qa-suite/lib/tx-io.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ioCalls } from './tx-io.mjs';

const texts = (body) => ioCalls(body).map((c) => c.text);

test('flags a real network call inside a transaction', () => {
  assert.deepEqual(texts('await fetch(url);'), ['fetch(']);
  assert.deepEqual(texts('await this.provider.send(message);'), ['this.provider.send(']);
  assert.deepEqual(texts('await this.gateway.charge(order);'), ['this.gateway.charge(']);
  assert.deepEqual(texts('await this.mailer.sendMail(mail);'), ['this.mailer.sendMail(']);
  assert.deepEqual(texts('await this.bsp.create(payload);'), ['this.bsp.create(']);
});

test('does not flag a call that is handed the transaction: it runs its queries on it', () => {
  // The case this was written for: "sendingLabels" matches send\\w*, but it only reads devices on `tx`.
  assert.deepEqual(texts('await this.senders.sendingLabels(tx, orgId, ids);'), []);
  assert.deepEqual(texts('await this.senders.wizard(rowTx, orgId);'), []);
  assert.deepEqual(texts('await this.gateway.create(trx, order);'), []);
  assert.deepEqual(texts('await this.client.create(this.tx, x);'), []);
});

test('still flags the same method when it is not given the transaction', () => {
  assert.equal(ioCalls('await this.senders.sendingLabels(orgId, ids);').length, 1);
  assert.equal(ioCalls('await this.senders.sendingLabels(txId, ids);').length, 1); // "txId" is not a transaction handle
  assert.equal(ioCalls('await this.provider.send(txn.id);').length, 1);
});

test('reports every call, with its position, not just the first', () => {
  const body = 'a(); await fetch(a); b(); await this.provider.send(m);';
  const found = ioCalls(body);
  assert.deepEqual(
    found.map((c) => c.text),
    ['fetch(', 'this.provider.send('],
  );
  assert.equal(body.slice(found[0].index, found[0].index + 6), 'fetch(');
  assert.equal(body.slice(found[1].index, found[1].index + 13), 'this.provider');
});

test('a body with no network call, or an empty one, has none', () => {
  assert.deepEqual(ioCalls(''), []);
  assert.deepEqual(ioCalls('await tx.execute(sql`select 1`); await this.repo.find(tx, id);'), []);
});

test('the real transaction check no longer reports the shops service (the false positive this fixes)', async () => {
  const { default: task } = await import('../tasks/46-transactions.mjs');
  const { checks } = await task.run();
  const io = checks.find((c) => c.id === 'tx-no-io');
  assert.ok(
    !(io.evidence ?? []).some((e) => e.includes('sendingLabels')),
    'sendingLabels is a transaction query, not a network call',
  );
});
