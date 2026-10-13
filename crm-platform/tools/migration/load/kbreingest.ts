import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * kb-reingest: the SEPARATE, operator-triggered step that makes WaDesk read the knowledge-base pages the load created.
 *
 * The load (handler knowledge_sources) writes every migrated website source as a `url` entry with status `failed` and the error
 * "Not fetched yet: re-ingest", and emits NO event: the tool never makes an outbound request and never writes event_outbox in a load.
 * This command does what the app's own SourcesService.add does for a URL entry, in ONE transaction per run: the entry is set to
 * `processing` and the outbox event `ai_training_source.requested` is written (event_outbox: org_id, aggregate_module
 * 'ai_training_sources', aggregate_id = the entry id, event_type, payload { _meta }). The app's worker then fetches each page with its
 * SSRF-safe fetcher and settles the entry (`ready` with the text, or `failed` with the reason). RISK: that means outbound HTTP requests
 * from the WaDesk worker to the client's own website, which is why it is explicit and never part of `run`.
 *
 * Only entries this tool migrated (migration.id_map, collection document_col) of kind url are looked at. Idempotent: an entry already
 * `ready` or `processing` gets no second event; only `failed` entries are reset (a failed re-read is retried by running it again).
 * REFUSED on --apply while a WhatsApp channel of the organization is connected. Dry run by default.
 */
export interface KbReingestOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  log: (line: string) => void;
}

export const SOURCE_REQUESTED = 'ai_training_source.requested';
export const KB_MODULE = 'ai_training_sources';

interface Entry {
  id: number | string;
  status: string;
  url: string | null;
}

/** What a run does with the entries: pure, so the rule is testable without a database. */
export function planReingest(entries: Array<{ id: number; status: string; url: string | null }>): {
  reset: number[];
  ready: number;
  processing: number;
  noUrl: number;
} {
  const out = { reset: [] as number[], ready: 0, processing: 0, noUrl: 0 };
  for (const e of entries) {
    if (e.status === 'ready') out.ready++;
    else if (e.status === 'processing') out.processing++;
    else if (!e.url) out.noUrl++;
    else out.reset.push(e.id);
  }
  return out;
}

const hostOf = (u: string | null): string => {
  try {
    return new URL(u ?? '').host;
  } catch {
    return '(invalid)';
  }
};

export async function kbReingest(o: KbReingestOptions): Promise<void> {
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
    if (!org) throw new Error(`KBREINGEST_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT s.id, s.status, s.url
          FROM ai_training_sources s
          JOIN migration.id_map m ON m.source_client = ${o.client} AND m.source_collection = 'document_col'
               AND m.target_table = 'ai_training_sources' AND m.target_org_id = ${orgId} AND m.target_id = s.id
          WHERE s.org_id = ${orgId} AND s.kind = 'url'
          ORDER BY s.id`),
      )
    ).rows as unknown as Entry[];
    const plan = planReingest(rows.map((r) => ({ id: Number(r.id), status: r.status, url: r.url })));
    const hosts = new Map<string, number>();
    for (const r of rows) if (plan.reset.includes(Number(r.id))) hosts.set(hostOf(r.url), (hosts.get(hostOf(r.url)) ?? 0) + 1);

    o.log(`  kb  ${rows.length} migrated url entries: ${plan.reset.length} to read, ${plan.ready} already ready, ${plan.processing} already processing, ${plan.noUrl} without an address`);
    for (const [h, n] of hosts) o.log(`  kb  would request ${n} page(s) from ${h}`);

    const connected = Number(
      (
        (
          await withTenant(worker.db, { orgId }, (tx) =>
            tx.execute(sql`SELECT count(*)::int AS n FROM channels WHERE org_id = ${orgId} AND status = 'connected'`),
          )
        ).rows[0] as { n: number }
      ).n,
    );
    if (connected > 0) o.log(`  kb  ${connected} WhatsApp channel(s) are connected: --apply is refused until none is`);
    if (!o.apply) {
      o.log('  kb  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>). Applying makes the WaDesk worker send HTTP requests to the sites above');
      return;
    }
    if (connected > 0)
      throw new Error(`KBREINGEST_CHANNEL_CONNECTED: ${connected} WhatsApp channel(s) are connected. Nothing was written`);
    if (plan.reset.length === 0) {
      o.log('  kb  nothing to read');
      return;
    }

    const payload = JSON.stringify({ _meta: { requestId: null, actorType: 'system', actorId: null } });
    const emitted = await withTenant(worker.db, { orgId }, async (tx) => {
      // only a row still failed is reset, so a concurrent or repeated run never emits a second event for the same entry
      const reset = (
        await tx.execute(sql`
          UPDATE ai_training_sources SET status = 'processing', error = NULL
          WHERE org_id = ${orgId} AND status = 'failed' AND id IN (${sql.join(plan.reset.map((id) => sql`${id}`), sql`, `)})
          RETURNING id`)
      ).rows as Array<{ id: number | string }>;
      for (const r of reset)
        await tx.execute(sql`
          INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
          VALUES (${orgId}, ${KB_MODULE}, ${Number(r.id)}, ${SOURCE_REQUESTED}, ${payload}::jsonb)`);
      return reset.length;
    });
    o.log(`  kb  done: ${emitted} entr${emitted === 1 ? 'y' : 'ies'} set to processing with ${SOURCE_REQUESTED}; the app worker now reads the pages`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
