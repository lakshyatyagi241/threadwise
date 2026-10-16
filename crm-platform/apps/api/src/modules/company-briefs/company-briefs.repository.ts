import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CompanyBriefContent } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface BriefRow {
  uuid: string;
  inputHash: string;
  content: CompanyBriefContent;
  provider: string;
  model: string;
  /** When it was written (regenerating overwrites the row and moves this). */
  updatedAt: Date;
}

/** Data access for `company_briefs`: one row per company and person. Every query carries the org; RLS is the backstop. */
@Injectable()
export class CompanyBriefsRepository {
  async find(
    tx: Tx,
    orgId: number,
    companyId: number,
    userId: number,
  ): Promise<BriefRow | undefined> {
    const res = await tx.execute(sql`
      SELECT uuid, input_hash, content, provider, model, updated_at
      FROM company_briefs
      WHERE org_id = ${orgId} AND company_id = ${companyId} AND user_id = ${userId}
    `);
    const r = res.rows[0] as
      | {
          uuid: string;
          input_hash: string;
          content: CompanyBriefContent;
          provider: string;
          model: string;
          updated_at: Date | string;
        }
      | undefined;
    return r
      ? {
          uuid: r.uuid,
          inputHash: r.input_hash,
          content: r.content,
          provider: r.provider,
          model: r.model,
          updatedAt: new Date(r.updated_at),
        }
      : undefined;
  }

  /** Writes the person's brief of the company, replacing the one there. `updated_at` is set explicitly: the cooldown reads it. */
  async upsert(
    tx: Tx,
    orgId: number,
    v: {
      companyId: number;
      userId: number;
      inputHash: string;
      content: CompanyBriefContent;
      provider: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    },
  ): Promise<{ row: BriefRow; replaced: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO company_briefs (org_id, company_id, user_id, input_hash, content, provider, model, prompt_tokens, completion_tokens)
      VALUES (${orgId}, ${v.companyId}, ${v.userId}, ${v.inputHash}, ${JSON.stringify(v.content)}::jsonb, ${v.provider}, ${v.model},
              ${v.promptTokens}, ${v.completionTokens})
      ON CONFLICT (org_id, company_id, user_id) DO UPDATE
        SET input_hash = EXCLUDED.input_hash, content = EXCLUDED.content, provider = EXCLUDED.provider, model = EXCLUDED.model,
            prompt_tokens = EXCLUDED.prompt_tokens, completion_tokens = EXCLUDED.completion_tokens, updated_at = now()
      RETURNING uuid, input_hash, content, provider, model, updated_at, (xmax <> 0) AS replaced
    `);
    const r = res.rows[0] as {
      uuid: string;
      input_hash: string;
      content: CompanyBriefContent;
      provider: string;
      model: string;
      updated_at: Date | string;
      replaced: boolean;
    };
    return {
      replaced: r.replaced,
      row: {
        uuid: r.uuid,
        inputHash: r.input_hash,
        content: r.content,
        provider: r.provider,
        model: r.model,
        updatedAt: new Date(r.updated_at),
      },
    };
  }
}
