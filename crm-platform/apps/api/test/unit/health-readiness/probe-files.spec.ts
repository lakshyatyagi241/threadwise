import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDbSaturationMetrics, Registry } from '@crm/observability';
import {
  Prober,
  parseProbeFiles,
} from '../../../src/modules/platform-infrastructure/observability/event-loop/probe';

describe('probe marker files and reachable targets (Sheet3 #73)', () => {
  it('exports the age of an existing marker and 0 presence for a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hr-'));
    const f = join(dir, '.last-ok');
    writeFileSync(f, '');
    const old = new Date(Date.now() - 100_000);
    utimesSync(f, old, old);
    const p = new Prober([{ name: 'x', url: 'http://127.0.0.1:1/' }], {
      files: [
        { name: 'backup', path: f },
        { name: 'offsite', path: join(dir, 'missing') },
      ],
    });
    const out = p.render();
    const age = /crm_probe_file_age_seconds\{[^}]*file="backup"[^}]*\} ([\d.]+)/.exec(out);
    expect(Number(age?.[1])).toBeGreaterThan(99);
    expect(out).toMatch(/crm_probe_file_present\{[^}]*file="offsite"[^}]*\} 0/);
    expect(out).not.toMatch(/crm_probe_file_age_seconds\{[^}]*file="offsite"/);
  });

  it('counts any HTTP answer as up for a reachable target only', async () => {
    const doFetch = (async () => new Response('denied', { status: 403 })) as typeof fetch;
    const p = new Prober(
      [
        { name: 's3', url: 'http://s3.test/' },
        { name: 'api', url: 'http://api.test/' },
      ],
      { doFetch, reachableNames: ['s3'] },
    );
    await p.runOnce();
    const out = p.render();
    expect(out).toMatch(/crm_probe_up\{[^}]*target="s3"[^}]*\} 1/);
    expect(out).toMatch(/crm_probe_up\{[^}]*target="api"[^}]*\} 0/);
  });

  it('rejects a malformed file spec', () => {
    expect(() => parseProbeFiles('backup=relative/path')).toThrow();
    expect(parseProbeFiles('')).toEqual([]);
  });

  it('crm_postgres_up is exported as 1 and 0', () => {
    const r = new Registry({ service: 'api', instance: 'i' });
    const m = createDbSaturationMetrics(r);
    m.recordUp(true);
    expect(r.render()).toMatch(/crm_postgres_up\{[^}]*\} 1/);
    m.recordUp(false);
    expect(r.render()).toMatch(/crm_postgres_up\{[^}]*\} 0/);
  });
});
