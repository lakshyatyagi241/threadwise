import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { coverage } from '../extract/coverage';
import { parseEjsonLine } from '../extract/ejson';
import { NdjsonDirSource } from '../extract/source';
import { REGISTRY, resolve } from '../registry';
import { phoneOf } from '../transform/contacts';
import { Oid, scrub, toDate, uuidv5 } from '../util';
import { O, writeFixtures } from './fixtures';

describe('extended json', () => {
  it('reads ObjectId, $date (string, long) and numbers', () => {
    const d = parseEjsonLine(
      JSON.stringify({
        _id: O(1),
        a: { $date: '2026-01-02T03:04:05Z' },
        b: { $date: { $numberLong: '1700000000000' } },
        c: { $numberInt: '5' },
        n: null,
      }),
    );
    expect(d._id).toBeInstanceOf(Oid);
    expect(String(d._id)).toBe('65f0a1b200000000' + '00000001');
    expect((d.a as Date).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect((d.b as Date).getTime()).toBe(1700000000000);
    expect(d.c).toBe(5);
  });
  it('reads dates written as Date, ISO string and epoch', () => {
    expect(toDate(new Date('2026-01-01'))?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(toDate('2026-03-05')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(toDate(1772359200000)?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
    expect(toDate('not a date')).toBeNull();
    expect(toDate(null)).toBeNull();
  });
  it('uuid v5 is deterministic', () => {
    expect(uuidv5('a|b|c')).toBe(uuidv5('a|b|c'));
    expect(uuidv5('a|b|c')).not.toBe(uuidv5('a|b|d'));
    expect(uuidv5('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('phones follow the app canonicaliser', () => {
  it.each([
    ['9812345671', '91', '+919812345671'],
    ['098123 45672', '91', '+919812345672'],
    ['+91 98123 45673', null, '+919812345673'],
    ['00919812345674', null, '+919812345674'],
    ['919812345675', '91', '+919812345675'],
    ['abc', null, null],
    ['12345', null, null],
    ['9812345676', null, null],
  ])('%s + cc %s -> %s', (raw, cc, want) => {
    expect(phoneOf(raw, cc, null)).toBe(want);
  });
  it('uses the default country code when the row has none', () => {
    expect(phoneOf('9812345676', null, '91')).toBe('+919812345676');
  });
});

describe('registry', () => {
  it('has no duplicate collections and phase 2 handlers are todo', () => {
    const names = REGISTRY.map((r) => r.collection);
    expect(new Set(names).size).toBe(names.length);
    for (const r of REGISTRY.filter((x) => x.disposition === 'MIGRATE_LATER'))
      expect(r.handler).toBe('todo');
    for (const r of REGISTRY.filter((x) => x.disposition === 'MIGRATE'))
      expect(r.handler).not.toBe('todo');
  });
  it('answers UNKNOWN for anything unlisted, and matches temp / backup patterns', () => {
    expect(resolve('brand_new_collection').disposition).toBe('UNKNOWN');
    expect(resolve('temp_import_contacts_obj').disposition).toBe('EXCLUDE');
    expect(resolve('credits_mapping_new_bkp').disposition).toBe('EXCLUDE');
    expect(resolve('contact_list').disposition).toBe('MIGRATE');
    expect(resolve('contact_task_config').disposition).toBe('GAP');
  });
});

describe('secrets are never copied', () => {
  it('removes credential-looking keys and records their paths', () => {
    const r = scrub({
      base_url: 'u',
      auth_token: 't',
      nested: { password: 'p', ok: 1 },
      list: [{ api_key: 'k' }],
    });
    expect(r.value).toEqual({ base_url: 'u', nested: { ok: 1 }, list: [{}] });
    expect(r.redacted.sort()).toEqual(['auth_token', 'list[0].api_key', 'nested.password']);
  });
});

describe('coverage over the invented fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migtool-cov-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('classifies every collection and flags an unlisted one as UNKNOWN', async () => {
    writeFixtures(dir, { bulk: 2 });
    const source = new NdjsonDirSource(dir);
    const rows = await coverage(source, dir, 'acme');
    const by = Object.fromEntries(rows.map((r) => [r.collection, r.status]));
    expect(by.contact_list).toBe('MIGRATED');
    expect(by.auth_logs).toBe('EXCLUDED');
    expect(by.temp_import_contacts_data).toBe('EXCLUDED');
    expect(by.credits_mapping_new_bak_20260930).toBe('EXCLUDED');
    expect(by.contact_task_config).toBe('GAP');
    expect(by.segments).toBe('MIGRATE_LATER');
    expect(rows.filter((r) => r.status === 'UNKNOWN')).toEqual([]);
    expect(rows.find((r) => r.collection === 'contact_list')?.count).toBe(11);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'acme', 'mystery.ndjson'),
      '{"_id":{"$oid":"65f0a1b2000000000000ffff"}}\n',
    );
    const again = await coverage(source, dir, 'acme');
    expect(again.find((r) => r.collection === 'mystery')?.status).toBe('UNKNOWN');
  });
});
