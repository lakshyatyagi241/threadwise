import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, parseInventory, priorityOf, statusOf } from './extract-acceptance.mjs';

const md = `---
domain: x
---
# X

## Feature index

| Id | Feature |
| -- | -- |
| TW-X-001 | One |

## Features

### TW-X-001 — First feature

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Acceptance criteria:**
  - Given a, when b, then c.
  - Given d, when e, then f.
- **Source refs:** a.php

### TW-X-002 — Second feature

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Acceptance criteria:**
  - Given one
    continued on the next line, then done.
- **Port notes:** none

### TW-X-003 — No criteria

- **Status:** missing
- **Priority:** P1
- **Source refs:** none
`;

test('finds features, status, priority and numbered criteria', () => {
  const f = parseInventory(md, 'x');
  assert.deepEqual(
    f.map((x) => x.id),
    ['TW-X-001', 'TW-X-002', 'TW-X-003'],
  );
  assert.equal(f[0].status, 'implemented');
  assert.equal(f[0].priority, 'P0');
  assert.deepEqual(
    f[0].criteria.map((c) => c.id),
    ['AC-TW-X-001-1', 'AC-TW-X-001-2'],
  );
  assert.equal(f[0].criteria[1].text, 'Given d, when e, then f.');
});
test('a wrapped criterion is not split and does not leak into the next field', () => {
  const f = parseInventory(md, 'x');
  assert.equal(f[1].criteria.length, 1);
  assert.equal(f[1].status, 'dead-code');
});
test('a feature with no criteria has none, and the index table is ignored', () => {
  const f = parseInventory(md, 'x');
  assert.equal(f[2].criteria.length, 0);
  assert.equal(f.length, 3);
});
test('flatten keeps the feature facts on every criterion', () => {
  const rows = flatten(parseInventory(md, 'x'));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    id: 'AC-TW-X-001-1',
    feature: 'TW-X-001',
    domain: 'x',
    status: 'implemented',
    priority: 'P0',
    title: 'First feature',
    text: 'Given a, when b, then c.',
  });
});
test('priorityOf reads the P-number only', () => {
  assert.equal(priorityOf('P1 (expected by customers)'), 'P1');
  assert.equal(priorityOf('later'), null);
});

test('headings with a colon and several fields on one line are read', () => {
  const f = parseInventory(
    '### TW-C-003: Create\n\n- **Status:** pending. **Priority:** P0. **Effort:** M.\n- **Rules:**\n  1. x\n',
    'c',
  );
  assert.equal(f[0].id, 'TW-C-003');
  assert.equal(f[0].priority, 'P0');
  assert.equal(f[0].status, 'pending');
  assert.equal(f[0].criteria.length, 0);
});
test('statusOf keeps one stable word', () => {
  assert.equal(statusOf('implemented'), 'implemented');
  assert.equal(statusOf('not in Reference (port addition: x)'), 'port-addition');
  assert.equal(statusOf('dead-code (nothing calls it)'), 'dead-code');
});
