/**
 * One outbox drain "node" for the multi-node test: a separate OS process with its own connection pool, running the real
 * `OutboxDrainService` against the shared database. Every event it handles is recorded in `conc_node_deliveries` (event id, node name),
 * on a connection of its own, before the handler returns.
 *
 * Run with tsx: DATABASE_URL, NODE_NAME, EVENT_TYPE required; HANDLE_MS slows each event so two nodes overlap.
 */
import 'reflect-metadata';
import { Client } from 'pg';
import { createDbClientPair } from '@crm/db';
import { DatabaseService } from '../../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../../src/kernel/outbox/outbox-subscribers';
import { OutboxDrainService } from '../../../../src/workers/outbox-drain.service';

const url = process.env.DATABASE_URL!;
const node = process.env.NODE_NAME!;
const eventType = process.env.EVENT_TYPE!;
const handleMs = Number(process.env.HANDLE_MS ?? 0);

async function main(): Promise<void> {
  const recorder = new Client({ connectionString: process.env.RECORDER_URL ?? url });
  await recorder.connect();
  const db = new DatabaseService(
    createDbClientPair(
      { url, poolMax: 5, statementTimeoutMs: 60_000, logQueries: false },
      undefined,
    ),
  );
  const registry = new OutboxSubscriberRegistry();
  registry.register({
    name: `conc-${node}`,
    eventTypes: [eventType],
    handle: async (e) => {
      await recorder.query(`INSERT INTO conc_node_deliveries (event_id, node) VALUES ($1, $2)`, [
        e.id,
        node,
      ]);
      if (handleMs > 0) await new Promise((r) => setTimeout(r, handleMs));
    },
  });
  const drain = new OutboxDrainService(db, registry);
  process.stdout.write(`READY ${node}\n`);
  for (;;) {
    await drain.drain();
    const left = await recorder.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status IN ('pending', 'processing')`,
      [eventType],
    );
    if (left.rows[0].n === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  process.stdout.write(`DONE ${node}\n`);
  await recorder.end();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${node} failed: ${String(err)}\n`);
  process.exit(1);
});
