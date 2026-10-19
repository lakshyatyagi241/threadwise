// Tests for the loop-shape filter of the N+1 check (QA task 43). Run: node --test tools/qa-suite/lib/loop-shape.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchedLoop } from './loop-shape.mjs';

test('a chunked walk is one statement per chunk, not per item', () => {
  assert.equal(
    batchedLoop('for (let i = 0; i < rows.length; i += 500) {', 'await tx.execute(x)'),
    'chunked',
  );
  assert.equal(
    batchedLoop('for (let start = job.processedRows; start < data.length; start += BATCH) {', ''),
    'chunked',
  );
});

test('a bounded retry is not a per-item write', () => {
  assert.equal(
    batchedLoop(
      'for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {',
      'await this.repo.markSent()',
    ),
    'retry',
  );
  assert.equal(batchedLoop('for (let draw = 0; draw < MAX_DRAWS; draw++) {', ''), 'retry');
  assert.equal(
    batchedLoop('for (const wait of CAPTURE_RETRIES) {', 'await this.recorder.record()'),
    'retry',
  );
  // a name that merely contains the letters is not a retry
  assert.equal(batchedLoop('for (const r of battempts) {', ''), null);
});

test('a LIMIT-bounded drain without element iteration is batched', () => {
  assert.equal(
    batchedLoop('for (;;) {', 'DELETE ... WHERE id IN (SELECT id FROM t LIMIT 1000)'),
    'drain',
  );
  assert.equal(
    batchedLoop('for (let i = 0; i < MAX_BATCHES; i++) {', 'SELECT ... LIMIT ${BATCH}'),
    'drain',
  );
  assert.equal(batchedLoop('while (sent < maxRows) {', 'SELECT ... LIMIT 500'), 'drain');
  // the LIMIT may live in the repository: a batch-size constant in the body is the same evidence
  assert.equal(
    batchedLoop('for (;;) {', 'const ids = await repo.nextIds(tx, where, DELETE_BATCH);'),
    'drain',
  );
});

test('a loop over the items that writes once per item stays flagged', () => {
  assert.equal(
    batchedLoop(
      'for (const r of rows) {',
      'await tx.execute(sql`UPDATE t SET x = 1 WHERE id = ${r.id}`)',
    ),
    null,
  );
  // LIMIT inside a per-item loop does not make it a drain
  assert.equal(batchedLoop('for (const r of rows) {', 'SELECT ... LIMIT 1'), null);
  assert.equal(batchedLoop('for (;;) {', 'await tx.execute(sql`UPDATE t SET x = 1`)'), null);
});
