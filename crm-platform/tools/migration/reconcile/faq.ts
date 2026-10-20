import { rowUuid } from '../load/engine';
import { sql, withTenant, type Database } from '../load/db';
import type { Outcome } from '../transform/types';

/**
 * The verifier of the faq_knowledge step, for what the generic column-by-column check of reconcile/index.ts cannot see (the agent is
 * resolved by the loader, so assistant_id is not in the fingerprint):
 *   - every loaded "FAQ" entry sits on an agent: the bot's own assistant when the document names one, else some agent of the organization
 *   - at most one tool-made "FAQ" entry per agent (the knowledge base holds one FAQ text per agent)
 *   - SAFETY, in SQL: the tool writes no passage and no vector (ai_training_chunks stays the application worker's), unless
 *     --allow-extra-rows (the worker legitimately cuts and embeds the entries after the cutover)
 */
interface Args {
  db: Database;
  orgId: number;
  client: string;
  items: Array<{ base: string; outcome: Extract<Outcome, { kind: 'rows' }> }>;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
}

export async function verifyFaq(a: Args): Promise<void> {
  const { db, orgId, client, alarm } = a;
  const want = new Map<string, number | null>(); // entry uuid -> the assistant the document names (null: any)
  for (const it of a.items) {
    const e = it.outcome.rows.find((r) => r.table === 'ai_training_sources');
    if (!e) continue;
    const id = e.row.assistant_id;
    want.set(rowUuid(client, 'faq_knowledge', it.base, e.sub), id === null || id === undefined ? null : Number(id));
  }
  if (want.size === 0) return;

  await withTenant(db, { orgId }, async (tx) => {
    const r = await tx.execute(sql`
      SELECT s.uuid::text AS uuid, s.assistant_id, s.kind, s.label
      FROM ai_training_sources s
      WHERE s.org_id = ${orgId} AND s.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify([...want.keys()])}::jsonb)::uuid)`);
    const perAgent = new Map<number, number>();
    for (const x of r.rows as Array<{
      uuid: string;
      assistant_id: number | string | null;
      kind: string;
      label: string;
    }>) {
      const named = want.get(x.uuid);
      if (x.kind !== 'text' || x.label !== 'FAQ')
        alarm(`FAQ_ENTRY_SHAPE: entry ${x.uuid.slice(0, 8)} is ${x.kind} "${x.label}", expected a text entry labelled FAQ`);
      if (x.assistant_id === null) {
        alarm(`FAQ_NO_AGENT: FAQ entry ${x.uuid.slice(0, 8)} belongs to no AI agent, so nothing can read it`);
        continue;
      }
      const agent = Number(x.assistant_id);
      if (named !== null && named !== undefined && named !== agent)
        alarm(`FAQ_WRONG_AGENT: FAQ entry ${x.uuid.slice(0, 8)} should sit on the assistant of its bot (${named}) and sits on ${agent}`);
      perAgent.set(agent, (perAgent.get(agent) ?? 0) + 1);
    }
    for (const [agent, n] of perAgent)
      if (n > 1) alarm(`FAQ_DUPLICATE_AGENT: agent ${agent} holds ${n} tool-made FAQ entries, expected one`);

    if (!a.allowExtraRows) {
      const t = (
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM ai_training_chunks c
          JOIN ai_training_sources s ON s.org_id = c.org_id AND s.id = c.source_id
          WHERE c.org_id = ${orgId} AND s.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify([...want.keys()])}::jsonb)::uuid)`)
      ).rows[0] as { n: number };
      if (t.n > 0)
        alarm(`FAQ_SAFETY: ${t.n} passage(s) already exist for the migrated FAQ entries; the tool writes none (the application's worker makes them)`);
    }
  });
}
