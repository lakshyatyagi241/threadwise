import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRss } from './sample.mjs';

test('reads resident memory from /proc status text', () => assert.equal(parseRss('Name:\tnode\nVmRSS:\t  204800 kB\nThreads:\t9\n'), 200));
test('gives null when the line is missing', () => assert.equal(parseRss('Name:\tnode\n'), null));
test('gives null for no text', () => assert.equal(parseRss(undefined), null));
