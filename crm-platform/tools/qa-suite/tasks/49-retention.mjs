// #49 Archival / retention: every high-volume or personal-data table has a retention rule and a mechanism that applies it.
import {
  ROOT,
  apiSrc,
  expectNone,
  exists,
  migrations,
  pass,
  read,
  unreviewed,
  warn,
  walk,
} from '../lib/core.mjs';
import { buildSchema } from '../lib/schema.mjs';
import { join } from 'node:path';

const VOLUME =
  /(_log|_logs|_events|_event|outbox|history|audit|webhook|delivery|deliveries|usage|ledger|archive|_runs|queue|attempts|visits|views|impressions)$/;

export default {
  id: 49,
  priority: 'P1',
  name: 'Archival / retention strategy',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const tables = [...buildSchema().values()].filter(
      (t) => t.columns.size > 1 && t.name.length > 2,
    );
    const candidates = tables.filter((t) => t.partitioned || VOLUME.test(t.name));
    // text that implements or documents retention: code, migrations, docs
    const corpus = [
      ...apiSrc().map(read),
      ...migrations().map(read),
      ...[...walk(join(ROOT, 'docs'), (p) => p.endsWith('.md'))].map(read),
    ].join('\n');
    const handled = (t) =>
      new RegExp(
        `(retention|purge|prune|expire|archive|cleanup|sweep|drop[_ ]partition|detach)[\\s\\S]{0,300}\\b${t.name}\\b|\\b${t.name}\\b[\\s\\S]{0,300}(retention|purge|prune|expire|archive|cleanup|sweep|drop[_ ]partition|detach)`,
        'i',
      ).test(corpus);
    const unhandled = candidates
      .filter((t) => !handled(t))
      .map((t) => `${t.name}${t.partitioned ? ' (partitioned)' : ''}`);
    const partNoDrop = tables
      .filter(
        (t) =>
          t.partitioned &&
          !new RegExp(
            `(drop|detach)[\\s\\S]{0,200}${t.name}|${t.name}[\\s\\S]{0,200}(drop|detach)`,
            'i',
          ).test(corpus),
      )
      .map((t) => t.name);
    const checks = [
      expectNone(
        'ret-tables',
        `Every high-volume table has a retention/archival rule (${candidates.length} candidates)`,
        unreviewed(49, unhandled),
        { level: 'warn' },
      ),
      expectNone(
        'ret-partitions',
        'Partitioned tables have a way to drop or detach old partitions (otherwise partitioning only slows growth)',
        unreviewed(49, partNoDrop),
        { level: 'warn' },
      ),
      exists('docs/privacy')
        ? pass('ret-policy-doc', 'A privacy/retention policy folder exists (docs/privacy)')
        : warn('ret-policy-doc', 'A written retention policy exists'),
      /ensure_monthly_partition/.test(corpus)
        ? pass(
            'ret-partition-create',
            'Future partitions are created by a helper (ensure_monthly_partition)',
          )
        : warn('ret-partition-create', 'Future partitions are created automatically'),
    ];
    return {
      checks,
      metrics: {
        tables: tables.length,
        'high-volume candidates': candidates.length,
        'with a retention reference': candidates.length - unhandled.length,
        partitioned: tables.filter((t) => t.partitioned).length,
      },
      target: {
        met: unhandled.length === 0,
        text: `${unhandled.length} high-volume tables have no retention rule anywhere in code, migrations or docs. A text match is evidence of a rule, not proof it runs: confirm each job in staging.`,
      },
    };
  },
};
