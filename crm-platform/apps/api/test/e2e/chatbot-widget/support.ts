import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { expect } from 'vitest';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, PASSWORD, bearer, startHarness, type Grant, type Harness, type Tenant };

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The smallest body the builder can send: every required field, whatsapp mode (no assistant needed). */
export const widgetBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Pricing page',
  mode: 'whatsapp',
  position: 'bottom_right',
  buttonColor: '#075E54',
  headerTitle: 'Chat with us',
  headerBg: '#075E54',
  headerTextColor: '#FFFFFF',
  messageBubbleColor: '#FFFFFF',
  messageTextColor: '#222222',
  bodyBgKind: 'color',
  bodyBgColor: '#ECE5DD',
  buttonLabel: 'Send message',
  actionButtonBg: '#075E54',
  actionButtonTextColor: '#FFFFFF',
  welcomeMessage: 'Hi! How can we help today?',
  targetWhatsappCc: '+91',
  targetWhatsappNumber: '9876543210',
  prefilledMessage: 'Hi there',
  ...over,
});

export interface WidgetJson {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused';
  mode: string;
  assistantId: string | null;
  embedToken: string;
  embedUrl: string;
  previewUrl: string;
  autoOpen: boolean;
  collectName: boolean;
  collectEmail: boolean;
  collectPhone: boolean;
  allowedDomains: string[];
  rowVersion: number;
  [k: string]: unknown;
}

let counter = 0;
let ipSeq = 1;
const nextClientIp = () => `10.88.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`;

/** Widget helpers on top of the contacts harness (same app, same database, organizations of their own). */
export class WidgetApi extends Api {
  /** A widget through the admin API as `token`. */
  async widget(token: string, over: Record<string, unknown> = {}): Promise<WidgetJson> {
    const res = await this.as(token).post('/v2/widgets').send(widgetBody(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as WidgetJson;
  }

  /** An assistant straight into the table (the AI agents domain owns its screens). */
  async assistant(
    t: Tenant,
    over: Partial<{
      name: string;
      status: string;
      systemPrompt: string | null;
      fallback: string | null;
      provider: string;
      model: string;
      tone: string;
      handoffKeyword: string | null;
    }> = {},
  ): Promise<{ id: number; uuid: string }> {
    const name = over.name ?? `Assistant ${counter++}`;
    const res = await this.h.owner.query(
      `INSERT INTO ai_chat_assistants (org_id, name, slug, status, system_prompt, fallback_message, ai_provider, ai_model, tone, handoff_keyword)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, uuid`,
      [
        t.orgId,
        name,
        `${name.toLowerCase().replace(/\W+/g, '-')}-${counter++}`,
        over.status ?? 'active',
        over.systemPrompt ?? null,
        over.fallback ?? null,
        over.provider ?? 'openai',
        over.model ?? 'gpt-4o-mini',
        over.tone ?? 'helpful',
        over.handoffKeyword ?? null,
      ],
    );
    return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
  }

  async source(
    t: Tenant,
    over: {
      assistantId?: number | null;
      label: string;
      content: string;
      kind?: string;
      status?: string;
      question?: string;
      answer?: string;
    },
  ): Promise<void> {
    await this.h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, question, answer, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        t.orgId,
        over.assistantId ?? null,
        over.kind ?? 'text',
        over.label,
        over.content,
        over.question ?? null,
        over.answer ?? null,
        over.status ?? 'ready',
      ],
    );
  }

  // --- the public side ---------------------------------------------------------------------------------------------------

  /**
   * The public calls as a visitor's browser makes them. Throttle counters are per client address (as in Reference), so each
   * `pub()` comes from a fresh address unless a test pins one to exercise the limit.
   */
  pub(token: string, ip: string = nextClientIp()) {
    const http = () => request(this.h.app.getHttpServer());
    const from = (headers: Record<string, string>) => ({ 'x-forwarded-for': ip, ...headers });
    return {
      embed: (route: 'embed' | 'embed.js' = 'embed') => http().get(`/widget/${token}/${route}`),
      chat: () => http().get(`/widget/${token}/chat`),
      config: (uuid?: string, headers: Record<string, string> = {}) =>
        http()
          .get(`/widget/${token}/api/config${uuid ? `?visitor_uuid=${uuid}` : ''}`)
          .set(from(headers)),
      message: (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
        http().post(`/widget/${token}/api/message`).set(from(headers)).send(body),
      history: (uuid: string | undefined, since = 0, headers: Record<string, string> = {}) =>
        http()
          .get(`/widget/${token}/api/history?since=${since}${uuid ? `&visitor_uuid=${uuid}` : ''}`)
          .set(from(headers)),
    };
  }

  /** The paused state has no screen or endpoint in Reference (TW-WGT-026); it is set in the database. */
  async setStatus(orgId: number, widgetUuid: string, status: 'active' | 'paused') {
    await this.h.owner.query(
      `UPDATE chatbot_widgets SET status = $3 WHERE org_id = $1 AND uuid = $2`,
      [orgId, widgetUuid, status],
    );
  }

  /** A visitor through the public config call. */
  async visitor(token: string): Promise<string> {
    const res = await this.pub(token).config();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.visitor.uuid as string;
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.h.owner.query(sql, params);
    return Number(res.rows[0].n);
  }

  /** The thread of a visitor, straight from the table, oldest first. */
  async thread(orgId: number, visitorUuid: string) {
    const res = await this.h.owner.query(
      `SELECT m.id, m.direction, m.sender_kind, m.body, m.status, m.meta, m.sender_user_id
       FROM messages m
       JOIN chatbot_widget_visitors v ON v.org_id = m.org_id AND v.conversation_id = m.conversation_id
       WHERE m.org_id = $1 AND v.visitor_uuid = $2 ORDER BY m.id`,
      [orgId, visitorUuid],
    );
    return res.rows as Array<{
      id: number;
      direction: string;
      sender_kind: string;
      body: string;
      status: string;
      meta: Record<string, unknown>;
      sender_user_id: number | null;
    }>;
  }

  async conversationOf(orgId: number, visitorUuid: string) {
    const res = await this.h.owner.query(
      `SELECT c.* FROM conversations c JOIN chatbot_widget_visitors v ON v.org_id = c.org_id AND v.conversation_id = c.id
       WHERE c.org_id = $1 AND v.visitor_uuid = $2`,
      [orgId, visitorUuid],
    );
    return res.rows[0] as Record<string, unknown> | undefined;
  }

  /** A reply typed by an operator in the team inbox: outbound, sent by a staff member and not by the widget's bot. */
  async agentReply(orgId: number, visitorUuid: string, body: string) {
    const conv = await this.conversationOf(orgId, visitorUuid);
    const res = await this.h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, body, status, sent_at)
       VALUES ($1, $2, (SELECT COALESCE(max(seq), 0) + 1 FROM messages WHERE org_id = $1 AND conversation_id = $2),
               'out', 'agent', $3, 'sent', now()) RETURNING id`,
      [orgId, conv!.id, body],
    );
    return Number(res.rows[0].id);
  }
}

/** A stand-in for the OpenAI chat-completions endpoint that records what it was asked and answers as told. */
export interface AiStub {
  url: string;
  calls: Array<{
    system: string;
    user: string;
    max_tokens: number;
    temperature: number;
    model: string;
  }>;
  /** What the next call does; a string is the reply text, an error throws a 500, 'empty' returns a blank reply. */
  next: string | 'error' | 'empty';
  stop(): Promise<void>;
}

export async function startAiStub(): Promise<AiStub> {
  const stub: AiStub = {
    url: '',
    calls: [],
    next: 'stub reply',
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });
  const server: Server = createServer((req, res) => {
    void readBody(req).then((raw) => {
      const body = JSON.parse(raw || '{}') as {
        model: string;
        max_tokens: number;
        temperature: number;
        messages: Array<{ role: string; content: string }>;
      };
      stub.calls.push({
        system: body.messages.find((m) => m.role === 'system')?.content ?? '',
        user: body.messages.find((m) => m.role === 'user')?.content ?? '',
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        model: body.model,
      });
      if (stub.next === 'error') {
        res.statusCode = 500;
        res.end('{"error":"boom"}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: stub.next === 'empty' ? '   ' : stub.next } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return stub;
}
