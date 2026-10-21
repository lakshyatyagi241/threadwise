import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AiCrmIndexResponse, AiCrmMessageResponse, AiCrmRecentAction, AiCrmSettingsResponse } from '@crm/contracts';
import { AICRM_ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  AI_CRM_PROVIDER_PORT,
  type AiCrmProviderPort,
  type AiCrmHistoryTurn,
} from '../../infra/providers/ai-copilot-lead-finder/ai-crm-provider.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { AiCrmActionsRepository } from './ai-crm-actions.repository';
import { AiCrmToolkitService } from './ai-crm-toolkit.service';
import { cacheMetrics } from '@crm/observability';

const historyCache = cacheMetrics('copilot_history');
const pendingCache = cacheMetrics('copilot_pending');

const PROVIDER_PRIORITY_ORDER = ['anthropic', 'openai', 'gemini'] as const;
const HISTORY_MAX_TURNS = 12;
const HISTORY_TTL_SECONDS = 60 * 60 * 2;
const PENDING_TTL_SECONDS = 60 * 10;
export const AFFIRMATIVE = /^\s*(yes|y|yeah|yep|ok|okay|confirm|confirmed|sure|do it|go|proceed)\b/i;
export const NEGATIVE = /^\s*(no|n|nope|cancel|stop|don'?t)\b/i;

const CHANNEL = 'dashboard';

interface PendingWrite {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * The AI CRM Copilot's orchestration (TW-AICRM-001, Reference's `AiCrmCopilotService`): resolves the workspace's AI
 * provider/key the same way every other AI feature does, runs one tool-calling turn, and enforces confirm-before-act
 * by parking any write-tool call in Redis until the user replies affirmatively. Every tool call (read or write) is
 * audit-logged. Conversation history is kept server-side in Redis, not the client, so it can't be tampered with
 * (Open question #1 in the inventory doc).
 */
@Injectable()
export class AiCrmCopilotService {
  private readonly logger = new Logger(AiCrmCopilotService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly actions: AiCrmActionsRepository,
    private readonly audit: AuditService,
    private readonly toolkit: AiCrmToolkitService,
    @Inject(AI_CRM_PROVIDER_PORT) private readonly provider: AiCrmProviderPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async index(): Promise<AiCrmIndexResponse> {
    const ctx = RequestContextStore.require();
    const [recentRows, waCopilotEnabled] = await Promise.all([
      this.db.txAs({ orgId: ctx.orgId, userId: null }, (tx) => this.actions.recent(tx, ctx.orgId, 12)),
      this.readWaCopilotEnabled(ctx.orgId),
    ]);
    const recent: AiCrmRecentAction[] = recentRows.map((r) => ({
      tool: r.tool,
      summary: r.result_summary,
      createdAt: r.created_at.toISOString(),
    }));
    return { recent, waCopilotEnabled, canManageSettings: Boolean(ctx.grants?.has('aicrm.copilot.manage')) };
  }

  async ask(message: string): Promise<AiCrmMessageResponse> {
    const ctx = RequestContextStore.require();
    const history = await this.history(ctx.orgId, ctx.userId);

    const pending = await this.pending(ctx.orgId, ctx.userId);
    if (pending && AFFIRMATIVE.test(message)) return this.runPending(ctx.orgId, ctx.userId, pending);
    if (pending && NEGATIVE.test(message)) {
      await this.clearPending(ctx.orgId, ctx.userId);
      await this.log(ctx.orgId, ctx.userId, pending.tool, 'write', 'cancelled', pending.args, 'Cancelled by user', null, null, 0);
      const cancelReply = 'Okay, cancelled — nothing was changed.';
      // Without this, the model's next turn has no memory a write was proposed and declined, and may re-propose it.
      await this.appendHistory(ctx.orgId, ctx.userId, history, message, cancelReply);
      return { reply: cancelReply, actions: [], pending: null, provider: null };
    }

    const resolved = await this.resolveProvider(ctx.orgId);
    if (!resolved) {
      throw new AppError(AICRM_ERROR_CODES.AICRM_NO_AI_PROVIDER, 'No AI provider is configured. Ask your admin to add an AI key.', 422);
    }
    const { provider, model, key } = resolved;

    const toolDefs = this.toolkit.definitions();
    let outcome;
    try {
      outcome = await this.provider.runTurn(provider, {
        apiKey: key,
        model,
        systemPrompt: this.systemPrompt(),
        history,
        message,
        tools: toolDefs,
        isWriteTool: (name) => this.toolkit.kindOf(name) === 'write',
        executeReadTool: async (name, args) => {
          const result = await this.toolkit.execute(name, args);
          await this.log(ctx.orgId, ctx.userId, name, 'read', result.ok ? 'ok' : 'error', args, result.summary, provider, model, 0);
          return result;
        },
      });
    } catch (err) {
      this.logger.warn({ err: String(err), provider }, '[AICRM] provider turn failed');
      // Every other outcome (read, pendingWrite, confirm, cancel) leaves a row in ai_crm_actions; a provider
      // failure must too, or repeated vendor outages/bad keys leave no trace in the workspace's own audit trail.
      await this.log(ctx.orgId, ctx.userId, 'chat', 'read', 'error', { message }, String(err), provider, model, 0);
      throw new AppError(AICRM_ERROR_CODES.AICRM_PROVIDER_FAILED, 'The AI service returned an error. Please try again.', 502);
    }

    await this.meter
      .record(ctx.orgId, {
        provider,
        model,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        billedAgainst: resolved.source,
      })
      .catch((err: unknown) => this.logger.warn({ err: String(err) }, '[AICRM] token ledger write failed'));

    if (outcome.pendingWrite) {
      const summary = this.describeWrite(outcome.pendingWrite.tool, outcome.pendingWrite.args);
      await this.setPending(ctx.orgId, ctx.userId, outcome.pendingWrite);
      await this.log(
        ctx.orgId,
        ctx.userId,
        outcome.pendingWrite.tool,
        'write',
        'needs_confirm',
        outcome.pendingWrite.args,
        summary,
        provider,
        model,
        outcome.promptTokens + outcome.completionTokens,
      );
      await this.appendHistory(ctx.orgId, ctx.userId, history, message, summary);
      return {
        reply: `${summary}\n\nReply YES to confirm, or NO to cancel.`,
        actions: outcome.actions,
        pending: { tool: outcome.pendingWrite.tool, summary },
        provider,
      };
    }

    await this.appendHistory(ctx.orgId, ctx.userId, history, message, outcome.reply);
    return { reply: outcome.reply, actions: outcome.actions, pending: null, provider };
  }

  async reset(): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.redis.del(this.historyKey(ctx.orgId, ctx.userId));
  }

  async getSettings(): Promise<AiCrmSettingsResponse> {
    const ctx = RequestContextStore.require();
    return { waCopilotEnabled: await this.readWaCopilotEnabled(ctx.orgId) };
  }

  async setSettings(enabled: boolean): Promise<AiCrmSettingsResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      // Lock the row so the recorded old value is the one this update replaces, even under two concurrent toggles.
      const before = await tx.execute(
        sql`SELECT wa_copilot_enabled FROM workspace_settings WHERE org_id = ${ctx.orgId} FOR UPDATE`,
      );
      const was = Boolean((before.rows[0] as { wa_copilot_enabled?: boolean } | undefined)?.wa_copilot_enabled);
      await tx.execute(sql`UPDATE workspace_settings SET wa_copilot_enabled = ${enabled} WHERE org_id = ${ctx.orgId}`);
      // A toggle that changes nothing is not an event; a real change is recorded with who made it (the audit row carries the actor).
      if (was !== enabled) {
        await this.audit.record(tx, {
          module: 'ai_copilot_settings',
          recordId: ctx.orgId,
          action: 'update',
          delta: { wa_copilot_enabled: { old: was, new: enabled } },
        });
      }
    });
    return { waCopilotEnabled: enabled };
  }

  // ---- confirm-before-act (runs a previously-parked write) --------------------------------------------------------

  private async runPending(orgId: number, userId: number | null, pending: PendingWrite): Promise<AiCrmMessageResponse> {
    await this.clearPending(orgId, userId);
    const result = await this.toolkit.execute(pending.tool, pending.args);
    await this.log(orgId, userId, pending.tool, 'write', result.ok ? 'confirmed' : 'error', pending.args, result.summary, null, null, 0, result);
    const reply = result.ok ? `Done. ${result.summary}` : `That failed: ${result.summary || 'unknown error'}`;
    const history = await this.history(orgId, userId);
    await this.appendHistory(orgId, userId, history, '(confirmed)', reply);
    return { reply, actions: [{ tool: pending.tool, summary: result.summary }], pending: null, provider: null };
  }

  private describeWrite(tool: string, args: Record<string, unknown>): string {
    const s = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? '?'));
    switch (tool) {
      case 'create_contact':
        return `I'll create a contact "${s(args.name) || '?'}".`;
      case 'create_deal':
        return `I'll create a deal "${s(args.title) || '?'}"${args.value ? ` worth ${s(args.value)}` : ''}${args.stage ? ` in stage "${s(args.stage)}"` : ''}.`;
      case 'move_deal_stage':
        return `I'll move the deal to stage "${s(args.stage)}".`;
      case 'create_company':
        return `I'll create a company "${s(args.name)}".`;
      case 'link_contact_company':
        return `I'll link that contact to company "${s(args.company_name)}".`;
      case 'create_invoice':
        return `I'll create an invoice for "${s(args.buyer_name)}" with ${Array.isArray(args.items) ? args.items.length : 0} item(s).`;
      case 'record_payment':
        return `I'll record a payment of ${s(args.amount)} against invoice ${s(args.invoice_number)}.`;
      case 'create_task':
        return `I'll create a task "${s(args.title)}"${args.assignee_name ? ` for ${s(args.assignee_name)}` : ''}.`;
      case 'assign_task':
        return `I'll assign the task to ${s(args.assignee_name)}.`;
      case 'complete_task':
        return `I'll mark the task as done.`;
      case 'create_quote':
        return `I'll create a ${s(args.doc_type) === 'estimate' ? 'estimate' : 'proposal'}${args.title ? ` "${s(args.title)}"` : ''} with ${Array.isArray(args.items) ? args.items.length : 0} line item(s).`;
      case 'send_message':
        return `I'll send a WhatsApp message to ${s(args.to)}.`;
      case 'send_quote':
        return `I'll send ${s(args.number)} to its buyer on WhatsApp.`;
      default:
        return `I'll run ${tool}.`;
    }
  }

  // ---- provider resolution + prompt ---------------------------------------------------------------------------

  private async resolveProvider(
    orgId: number,
  ): Promise<{ provider: string; model: string; key: string; source: 'workspace' | 'admin' } | null> {
    // Each vendor is resolved at most once: the second pass (the platform's key) reuses what the first pass already read.
    const resolved = new Map<string, Awaited<ReturnType<typeof this.keys.resolve>>>();
    const resolve = async (provider: (typeof PROVIDER_PRIORITY_ORDER)[number]) => {
      let r = resolved.get(provider);
      if (!r) {
        r = await this.keys.resolve(orgId, provider);
        resolved.set(provider, r);
      }
      return r;
    };
    for (const provider of PROVIDER_PRIORITY_ORDER) {
      const r = await resolve(provider);
      if (r.key && r.source === 'workspace') return { provider, model: r.model ?? this.defaultModel(provider), key: r.key, source: 'workspace' };
    }
    for (const provider of PROVIDER_PRIORITY_ORDER) {
      const r = await resolve(provider);
      if (r.key) return { provider, model: r.model ?? this.defaultModel(provider), key: r.key, source: 'admin' };
    }
    return null;
  }

  private defaultModel(provider: string): string {
    switch (provider) {
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-haiku-4-5-20251001';
      case 'gemini':
        return 'gemini-3.5-flash';
      default:
        return '';
    }
  }

  private systemPrompt(): string {
    return (
      'You are the AI CRM Copilot, helping a business staff member manage their CRM by chat. ' +
      'Use the provided tools to search and modify contacts, companies and deals, to create invoices, record ' +
      'payments, list what is outstanding, report sales figures, and to create proposals or estimates (priced ' +
      'quotes with a shareable link). Always call a tool to get real data — never invent contacts, deals, invoices, ' +
      'or numbers. When a tool needs a phone number or a deal id you do not have, first search for it. Keep replies ' +
      'short, clear, and business-like. Do not use markdown tables; use short lines. ' +
      `Today is ${new Date().toISOString().slice(0, 10)}.`
    );
  }

  // ---- history (Redis) ------------------------------------------------------------------------------------------

  private historyKey(orgId: number, userId: number | null): string {
    return `aicrm:history:${orgId}:${userId ?? 0}`;
  }

  private async history(orgId: number, userId: number | null): Promise<AiCrmHistoryTurn[]> {
    const raw = await this.redis.get(this.historyKey(orgId, userId));
    if (raw) historyCache.hit();
    else historyCache.miss();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AiCrmHistoryTurn[]) : [];
    } catch {
      return [];
    }
  }

  private async appendHistory(
    orgId: number,
    userId: number | null,
    history: AiCrmHistoryTurn[],
    userMessage: string,
    assistantReply: string,
  ): Promise<void> {
    const next = [...history, { role: 'user' as const, text: userMessage }, { role: 'assistant' as const, text: assistantReply }];
    const trimmed = next.length > HISTORY_MAX_TURNS ? next.slice(next.length - HISTORY_MAX_TURNS) : next;
    await this.redis.setex(this.historyKey(orgId, userId), HISTORY_TTL_SECONDS, JSON.stringify(trimmed));
  }

  // ---- pending (Redis) --------------------------------------------------------------------------------------------

  private pendingKey(orgId: number, userId: number | null): string {
    return `aicrm:pending:${orgId}:${userId ?? 0}:${CHANNEL}`;
  }

  private async pending(orgId: number, userId: number | null): Promise<PendingWrite | null> {
    const raw = await this.redis.get(this.pendingKey(orgId, userId));
    if (raw) pendingCache.hit();
    else pendingCache.miss();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingWrite;
    } catch {
      return null;
    }
  }

  private async setPending(orgId: number, userId: number | null, data: PendingWrite): Promise<void> {
    await this.redis.setex(this.pendingKey(orgId, userId), PENDING_TTL_SECONDS, JSON.stringify(data));
  }

  private async clearPending(orgId: number, userId: number | null): Promise<void> {
    await this.redis.del(this.pendingKey(orgId, userId));
  }

  // ---- settings (existing, unwired workspace_settings column) ------------------------------------------------------

  private async readWaCopilotEnabled(orgId: number): Promise<boolean> {
    const row = await this.db.tx((tx) =>
      tx.execute(sql`SELECT wa_copilot_enabled FROM workspace_settings WHERE org_id = ${orgId}`),
    );
    return Boolean((row.rows[0] as { wa_copilot_enabled?: boolean } | undefined)?.wa_copilot_enabled);
  }

  // ---- audit log ------------------------------------------------------------------------------------------------

  private async log(
    orgId: number,
    userId: number | null,
    tool: string,
    kind: 'read' | 'write',
    status: 'ok' | 'error' | 'needs_confirm' | 'confirmed' | 'cancelled',
    params: Record<string, unknown>,
    summary: string,
    provider: string | null,
    model: string | null,
    tokens: number,
    result?: { subjectType?: string | null; subjectId?: number | null },
  ): Promise<void> {
    try {
      await this.db.txAs({ orgId, userId }, (tx) =>
        this.actions.log(tx, orgId, {
          userId,
          channel: CHANNEL,
          tool,
          kind,
          status,
          params: this.maskParams(params),
          resultSummary: summary,
          provider,
          model,
          tokens,
          subjectType: result?.subjectType ?? null,
          subjectId: result?.subjectId ?? null,
        }),
      );
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[AICRM] audit log write failed');
    }
  }

  private maskParams(params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && /phone|mobile/i.test(k)) {
        out[k] = maskPhone(v);
      } else if (typeof v === 'string' && k.toLowerCase() === 'email' && v.includes('@')) {
        const [u, d] = v.split('@', 2);
        out[k] = `${(u ?? '').slice(0, 2)}***@${d ?? ''}`;
      } else if (typeof v === 'string' && looksLikePhone(v)) {
        // `send_message`'s `to` (phone OR a contact name) and anything else that doesn't carry "phone"/"mobile"
        // in its key but is itself a phone number — masked by shape, not just by key name.
        out[k] = maskPhone(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, '');
  if (digits.length <= 4) return digits;
  return '*'.repeat(Math.max(0, digits.length - 4)) + digits.slice(-4);
}

/** A string that is mostly digits and long enough to be a phone number, e.g. `send_message`'s `to` argument. */
export function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D+/g, '');
  return digits.length >= 6 && digits.length >= value.replace(/\s+/g, '').length * 0.7;
}
