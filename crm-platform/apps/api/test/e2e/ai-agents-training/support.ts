import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'supertest';
import { expect } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Harness, type Tenant };

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AssistantJson {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused';
  greeting: string | null;
  systemPrompt: string | null;
  tone: string;
  language: string;
  aiProvider: string;
  aiModel: string;
  replyMaxTokens: number;
  temperature: number;
  fallbackMessage: string | null;
  handoffEnabled: boolean;
  handoffKeyword: string | null;
  handoffMessage: string | null;
  sourceCount: number;
  rowVersion: number;
  [k: string]: unknown;
}

export interface SourceJson {
  id: string;
  assistantId: string | null;
  kind: string;
  label: string;
  url: string | null;
  status: 'ready' | 'processing' | 'failed';
  tokensEstimate: number | null;
  error: string | null;
  hasFile: boolean;
  [k: string]: unknown;
}

/** The wizard's whole form, as the builder sends it. */
export const assistantBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Pricing concierge',
  status: 'active',
  greeting: 'Hi! How can I help today?',
  systemPrompt: 'Be brief.',
  tone: 'friendly',
  language: 'en',
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  replyMaxTokens: 400,
  temperature: 0.7,
  fallbackMessage: 'A teammate will follow up.',
  handoffEnabled: true,
  handoffKeyword: 'talk to human',
  handoffMessage: 'Pulling in a teammate.',
  ...over,
});

export class TrainingApi extends Api {
  async assistant(token: string, over: Record<string, unknown> = {}): Promise<AssistantJson> {
    const res = await this.as(token).post('/v2/ai-training/assistants').send(assistantBody(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as AssistantJson;
  }

  async textSource(
    token: string,
    assistantId: string,
    label = 'Facts',
    content = 'We open at nine.',
  ) {
    const res = await this.as(token)
      .post(`/v2/ai-training/assistants/${assistantId}/sources`)
      .send({ kind: 'text', label, content });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as SourceJson;
  }

  async upload(
    token: string,
    assistantId: string,
    file: { name: string; data: Buffer },
    label: string | null = 'A file',
  ): Promise<Response> {
    let req = this.as(token)
      .post(`/v2/ai-training/assistants/${assistantId}/sources/file`)
      .attach('file', file.data, file.name);
    if (label !== null) req = req.field('label', label);
    return req;
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.h.owner.query(sql, params);
    return Number(res.rows[0].n);
  }

  /** The stored file keys of an assistant's entries (server-side only; the API never shows them). */
  async fileKeys(orgId: number, assistantUuid?: string): Promise<string[]> {
    const res = await this.h.owner.query(
      `SELECT s.file_path FROM ai_training_sources s
         LEFT JOIN ai_chat_assistants a ON a.org_id = s.org_id AND a.id = s.assistant_id
       WHERE s.org_id = $1 AND s.file_path IS NOT NULL AND ($2::uuid IS NULL OR a.uuid = $2::uuid)
       ORDER BY s.id`,
      [orgId, assistantUuid ?? null],
    );
    return res.rows.map((r) => r.file_path as string);
  }

  async internalId(orgId: number, uuid: string): Promise<number> {
    const res = await this.h.owner.query(
      `SELECT id FROM ai_chat_assistants WHERE org_id = $1 AND uuid = $2`,
      [orgId, uuid],
    );
    return Number(res.rows[0].id);
  }
}

/** Whether a stored file exists on disk under the media root the e2e run uses. */
export const fileOnDisk = (root: string, key: string): boolean => existsSync(join(root, key));
export const filesUnder = (root: string, orgId: number): string[] => {
  const dir = join(root, 'ai-training', String(orgId));
  return existsSync(dir) ? readdirSync(dir) : [];
};
