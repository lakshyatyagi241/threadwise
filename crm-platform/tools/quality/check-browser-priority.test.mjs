import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, specFolders } from './check-browser-priority.mjs';

// A tiny in-memory tree: path -> children (a path with children is a folder).
const tree = {
  '/e2e': ['a', 'b', 'c', '.results', 'priority.json'],
  '/e2e/a': ['x.spec.ts'],
  '/e2e/b': ['sub'],
  '/e2e/b/sub': ['deep.spec.ts'],
  '/e2e/c': ['helper.ts'],
  '/e2e/.results': ['t.spec.ts'],
};
const fs = { list: (d) => tree[d] ?? [], isDir: (p) => p in tree };

test('finds the folders that hold a spec at any depth, and skips hidden folders and folders with only helpers', () => {
  assert.deepEqual(specFolders('/e2e', fs), ['a', 'b']);
});
test('a complete classification has no problems', () => {
  assert.deepEqual(check(['a', 'b'], { a: 'P0', b: 'P1' }), []);
});
test('an unclassified folder, an unknown level, a stale entry and a missing P0 are all reported', () => {
  const e = check(['a', 'b'], { a: 'P3', z: 'P1' });
  assert.ok(e.some((m) => m.includes('e2e/b has specs but no priority')));
  assert.ok(e.some((m) => m.includes('"P3" is not P0, P1 or P2')));
  assert.ok(e.some((m) => m.includes('e2e/z is classed but has no specs')));
  assert.ok(e.some((m) => m.includes('no folder is classed P0')));
});
