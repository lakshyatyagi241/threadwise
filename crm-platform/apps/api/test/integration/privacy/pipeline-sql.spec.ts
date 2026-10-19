import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import {
  PersonalDataErasureService,
  ALL_TIERS,
} from '../../../src/modules/privacy/engine/erasure.service';
import { SubjectResolver } from '../../../src/modules/privacy/engine/subject-resolver';
import { LegalHoldGuard } from '../../../src/modules/privacy/legal-holds/legal-hold.guard';
import { PERSONAL_DATA_REGISTRY } from '../../../src/modules/privacy/registry';
import type { PrivacyCtx, ResolvedSubject } from '../../../src/modules/privacy/registry/types';

/** These tests hold nobody: the guard only reads through the transaction it is given, so it needs no database service of its own. */
const noHold = new LegalHoldGuard(null as never);

/**
 * Every statement the registry can generate (count, export read, delete, anonymise) is run once against the real migrated schema,
 * inside a transaction that is rolled back, for a subject that matches nothing. A typo in a column or a replacement that the database
 * refuses fails here without needing an end-to-end run. Needs `REGISTRY_TEST_DATABASE_URL` (a migrated scratch database); skipped without it.
 */
const URL = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL)('registry statements run on the real schema', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: URL });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const subject: ResolvedSubject = {
    orgId: 1,
    contactIds: [1],
    contactUuids: ['00000000-0000-4000-8000-000000000001'],
    userIds: [1],
    userEmails: ['staff@example.test'],
    leadIds: [1],
    conversationIds: [1],
    conversationUuids: ['00000000-0000-4000-8000-000000000002'],
    phoneDigits: ['919800000001'],
    emails: ['x@example.test'],
    peerKeys: ['919800000001'],
  };

  async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      const db = drizzle(client) as unknown as Tx;
      return await fn(db);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('dry run, execute (both history modes) and export run without a database error', async () => {
    const eraser = new PersonalDataErasureService(new SubjectResolver(), noHold);
    for (const mode of ['delete', 'anonymise'] as const) {
      await inRolledBackTx(async (tx) => {
        const dry = await eraser.run(tx, {
          orgId: 1,
          requestId: null,
          subject,
          tiers: ALL_TIERS,
          mode,
          dryRun: true,
        });
        const real = await eraser.run(tx, {
          orgId: 1,
          requestId: null,
          subject,
          tiers: ALL_TIERS,
          mode,
          dryRun: false,
        });
        expect(real.report.lines.map((l) => l.table)).toEqual(dry.report.lines.map((l) => l.table));
        expect(dry.report.lines.length).toBeGreaterThan(90);
      });
    }
    await inRolledBackTx(async (tx) => {
      const ctx: PrivacyCtx = {
        tx,
        orgId: 1,
        requestId: null,
        tiers: ALL_TIERS,
        dryRun: false,
        now: new Date(),
      };
      for (const holder of PERSONAL_DATA_REGISTRY) {
        const section = await holder.export(ctx, subject);
        expect(section.tables.length).toBe(holder.tables.length);
      }
    });
  });
});
