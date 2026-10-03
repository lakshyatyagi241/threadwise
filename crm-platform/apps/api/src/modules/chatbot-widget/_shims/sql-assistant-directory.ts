import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { AssistantDirectory, AssistantProfile, AssistantRef, KnowledgeSource } from './tokens';

interface RefRow {
  id: number | string;
  uuid: string;
  name: string;
}

interface ProfileRow extends RefRow {
  system_prompt: string | null;
  tone: string | null;
  language: string | null;
  ai_provider: string;
  ai_model: string;
  reply_max_tokens: number | null;
  temperature: string | number | null;
  fallback_message: string | null;
  handoff_enabled: boolean;
  handoff_keyword: string | null;
  handoff_message: string | null;
}

const toRef = (r: RefRow): AssistantRef => ({ id: Number(r.id), uuid: r.uuid, name: r.name });

/** Reads `ai_chat_assistants` and `ai_training_sources` directly until the AI agents domain exports its service. */
@Injectable()
export class SqlAssistantDirectory implements AssistantDirectory {
  async listActive(tx: Tx, orgId: number): Promise<AssistantRef[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name FROM ai_chat_assistants
      WHERE org_id = ${orgId} AND status = 'active'
      ORDER BY name, id`);
    return (res.rows as unknown as RefRow[]).map(toRef);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<AssistantRef | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name FROM ai_chat_assistants WHERE org_id = ${orgId} AND uuid = ${uuid}`);
    const row = res.rows[0] as unknown as RefRow | undefined;
    return row ? toRef(row) : undefined;
  }

  async profile(tx: Tx, orgId: number, assistantId: number): Promise<AssistantProfile | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, system_prompt, tone, language, ai_provider, ai_model, reply_max_tokens, temperature,
             fallback_message, handoff_enabled, handoff_keyword, handoff_message
      FROM ai_chat_assistants WHERE org_id = ${orgId} AND id = ${assistantId}`);
    const r = res.rows[0] as unknown as ProfileRow | undefined;
    if (!r) return undefined;
    return {
      ...toRef(r),
      systemPrompt: r.system_prompt,
      tone: r.tone,
      language: r.language,
      aiProvider: r.ai_provider,
      aiModel: r.ai_model,
      replyMaxTokens: r.reply_max_tokens === null ? null : Number(r.reply_max_tokens),
      temperature: r.temperature === null ? null : Number(r.temperature),
      fallbackMessage: r.fallback_message,
      handoffEnabled: r.handoff_enabled,
      handoffKeyword: r.handoff_keyword,
      handoffMessage: r.handoff_message,
    };
  }

  async knowledge(tx: Tx, orgId: number, assistantId: number): Promise<KnowledgeSource[]> {
    const res = await tx.execute(sql`
      SELECT label, kind, content, question, answer FROM ai_training_sources
      WHERE org_id = ${orgId} AND (assistant_id IS NULL OR assistant_id = ${assistantId}) AND status = 'ready'
      ORDER BY id`);
    return res.rows as unknown as KnowledgeSource[];
  }
}
