import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { SharedSavedRepliesReader } from '../team-inbox-conversations';
import { AGENT_SAVED_REPLIES_MAX, buildSavedRepliesSection } from './agent-saved-replies';

/**
 * The consumer of `ai_agents.use_saved_replies` (BL-105, Reference's AiAgentService): for an inbox AI agent with the switch on, the
 * section of its system prompt that carries the workspace's most used SHARED saved replies as examples. Off, unknown agent or another
 * workspace's agent: an empty string. The reply loop of the inbox AI agents (TW-AIAG-017) appends this to the agent's prompt; that loop
 * is not part of this repo yet, so this is the whole contract it needs.
 */
@Injectable()
export class AgentSavedRepliesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly shared: SharedSavedRepliesReader,
  ) {}

  /** `ref`: the agent's row id or its uuid. */
  async promptSection(orgId: number, ref: { id: number } | { uuid: string }): Promise<string> {
    const agent = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        'id' in ref
          ? sql`SELECT use_saved_replies FROM ai_agents WHERE org_id = ${orgId} AND id = ${ref.id}`
          : sql`SELECT use_saved_replies FROM ai_agents WHERE org_id = ${orgId} AND uuid = ${ref.uuid}::uuid`,
      );
      const name = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${orgId}`);
      return {
        on:
          (res.rows[0] as { use_saved_replies?: boolean } | undefined)?.use_saved_replies === true,
        workspaceName: ((name.rows[0] as { name?: string } | undefined)?.name ?? '').trim(),
      };
    });
    if (!agent.on) return '';
    // A few more than the cap are read so replies left out for their variables do not shrink the list below 15.
    const replies = await this.shared.top(orgId, AGENT_SAVED_REPLIES_MAX * 3);
    return buildSavedRepliesSection(replies, {
      workspaceName: agent.workspaceName,
      today: new Date().toISOString().slice(0, 10),
    }).text;
  }
}
