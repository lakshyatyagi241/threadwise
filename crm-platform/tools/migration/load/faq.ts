import { sql, type TenantTx } from './db';
import type { Row } from '../transform/types';

/**
 * The loader half of the faq_knowledge step (step beforeInsert hook, load/flows.ts). A "FAQ" entry whose bot has an assistant of its
 * own already carries it; the shared entry (assistant_id NULL) goes to the agent the knowledge-base merge migration
 * (20270205090000_kb_per_agent_vector_faq_merge.sql) falls back to: the workspace's first ACTIVE agent, else its first agent. A workspace
 * that has no agent at all gets one "FAQ assistant" first, as that migration does, so the entry has an agent to live on. Returns how
 * many rows were given an agent.
 */
export async function assignKbFaqAgent(tx: TenantTx, orgId: number, rows: Row[]): Promise<number> {
  const open = rows.filter((r) => r.assistant_id === null || r.assistant_id === undefined);
  if (open.length === 0) return 0;
  await tx.execute(sql`
    INSERT INTO ai_chat_assistants (org_id, name, slug, greeting)
    SELECT ${orgId}::bigint, 'FAQ assistant', 'faq-assistant', 'Hi! Ask me anything.'
    WHERE NOT EXISTS (SELECT 1 FROM ai_chat_assistants WHERE org_id = ${orgId})
    ON CONFLICT DO NOTHING`);
  const found = await tx.execute(sql`
    SELECT id FROM ai_chat_assistants WHERE org_id = ${orgId}
    ORDER BY (status = 'active') DESC, id LIMIT 1`);
  const id = (found.rows[0] as { id: number | string } | undefined)?.id;
  if (id === undefined) throw new Error('FAQ entry: the workspace has no AI agent to hold it');
  for (const r of open) r.assistant_id = Number(id);
  return open.length;
}
