import { sentInteractiveFrom } from '../inbox/parse';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * chat-buttons: gives the bot messages an EARLIER load wrote without their buttons (Visit our website, Call now, quick replies ...)
 * the `meta.sentInteractive` the inbox draws them from. The Waboo button list was kept in `meta.legacy.interactive`, so no dump is
 * needed: this reads only the database.
 * Which rows: messages of ONE organization that this tool loaded (migration.id_map, collection chathistory), outbound, of any kind (a button message with an image header is kind `image`), with `meta.legacy.interactive` and without `meta.sentInteractive`.
 * What changes: that one meta key (inbox/parse.ts sentInteractiveFrom). Not the body, kind, counters or any conversation, so there is
 * no run_log record: `messages` has no touch trigger and the verifier does not compare message meta. Idempotent. Dry run by default.
 */
export interface ChatButtonsOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  batch?: number;
  log: (line: string) => void;
}

export async function chatButtons(o: ChatButtonsOptions): Promise<void> {
  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org)
      throw new Error(`CHATBUTTONS_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT m.id, m.created_at::text AS created_at, m.body, m.meta #> '{legacy,interactive}' AS interactive
          FROM messages m
          JOIN migration.id_map im ON im.source_client = ${o.client} AND im.source_collection = 'chathistory'
               AND im.target_table = 'messages' AND im.target_org_id = ${orgId} AND im.target_id = m.id
          WHERE m.org_id = ${orgId} AND m.direction = 'out'
            AND m.meta #> '{legacy,interactive}' IS NOT NULL AND m.meta -> 'sentInteractive' IS NULL`),
      )
    ).rows as unknown as Array<{ id: number | string; created_at: string; body: string | null; interactive: unknown }>;

    const todo = rows
      .map((r) => ({ r, s: sentInteractiveFrom(r.interactive, r.body) }))
      .filter((p): p is { r: (typeof rows)[number]; s: Record<string, unknown> } => p.s !== null);
    o.log(
      `  buttons  ${rows.length} bot message(s) of this tool with a button payload without buttons: ${todo.length} ${o.apply ? 'to fix' : 'would be fixed'}, ${rows.length - todo.length} have no button list`,
    );
    if (!o.apply) {
      o.log('  buttons  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }
    let done = 0;
    for (let i = 0; i < todo.length; i += o.batch ?? 500) {
      const part = todo.slice(i, i + (o.batch ?? 500));
      done += await withTenant(worker.db, { orgId }, async (tx) => {
        let n = 0;
        for (const p of part) {
          const res = await tx.execute(sql`
            UPDATE messages SET meta = meta || jsonb_build_object('sentInteractive', ${JSON.stringify(p.s)}::jsonb)
            WHERE org_id = ${orgId} AND id = ${Number(p.r.id)} AND created_at = ${p.r.created_at}::timestamptz
              AND meta -> 'sentInteractive' IS NULL
            RETURNING id`);
          n += res.rows.length;
        }
        return n;
      });
    }
    o.log(`  buttons  done: ${done} message(s) now carry their buttons`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
