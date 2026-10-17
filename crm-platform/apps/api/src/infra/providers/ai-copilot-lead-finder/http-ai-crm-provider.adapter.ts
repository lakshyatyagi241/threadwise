import { Injectable } from '@nestjs/common';
import type {
  AiCrmProviderPort,
  AiCrmExecutedAction,
  AiCrmToolDef,
  AiCrmTurnInput,
  AiCrmTurnOutcome,
} from './ai-crm-provider.port';

/** Reference capped the loop at 5 steps and 800 output tokens per step; kept the same budget here. */
const MAX_STEPS = 5;
const MAX_TOKENS = 800;
const TIMEOUT_MS = 45_000;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Calls the model vendor over HTTPS with a hard timeout. The key is the caller's: this class never reads one from the environment. */
@Injectable()
export class HttpAiCrmProviderAdapter implements AiCrmProviderPort {
  async runTurn(provider: string, input: AiCrmTurnInput): Promise<AiCrmTurnOutcome> {
    const p = provider.trim().toLowerCase();
    if (p === 'anthropic') return this.anthropic(input);
    if (p === 'gemini' || p === 'google') return this.gemini(input);
    if (p === 'openai') return this.openai(input);
    throw new Error(`no AI CRM Copilot adapter for provider ${provider}`);
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
    return res.json();
  }

  private baseUrl(envVar: string, fallback: string): string {
    return (process.env[envVar]?.trim() || fallback).replace(/\/+$/, '');
  }

  // ---- OpenAI (chat completions, function-calling) -------------------------------------------------------------

  private async openai(input: AiCrmTurnInput): Promise<AiCrmTurnOutcome> {
    const base = this.baseUrl('AICRM_OPENAI_BASE_URL', 'https://api.openai.com/v1');
    const messages: Array<Record<string, unknown>> = [{ role: 'system', content: input.systemPrompt }];
    for (const h of input.history) messages.push({ role: h.role, content: h.text });
    messages.push({ role: 'user', content: input.message });

    const tools = input.tools.map((d) => toOpenAiTool(d));
    const actions: AiCrmExecutedAction[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const json = (await this.post(
        `${base}/chat/completions`,
        { authorization: `Bearer ${input.apiKey}` },
        { model: input.model, max_tokens: MAX_TOKENS, temperature: 0.2, messages, tools },
      )) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: OpenAiToolCall[] } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      promptTokens += num(json.usage?.prompt_tokens);
      completionTokens += num(json.usage?.completion_tokens);
      const msg = json.choices?.[0]?.message ?? {};
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return { reply: (msg.content ?? '').trim() || 'Done.', actions, pendingWrite: null, promptTokens, completionTokens };
      }

      messages.push(msg);
      for (const call of calls) {
        const name = call.function?.name ?? '';
        const args = parseJsonArgs(call.function?.arguments);
        if (input.isWriteTool(name)) {
          return { reply: '', actions, pendingWrite: { tool: name, args }, promptTokens, completionTokens };
        }
        const result = await input.executeReadTool(name, args);
        actions.push({ tool: name, summary: result.summary });
        messages.push({ role: 'tool', tool_call_id: call.id ?? '', content: JSON.stringify(result.data ?? result) });
      }
    }
    return { reply: outOfStepsReply, actions, pendingWrite: null, promptTokens, completionTokens };
  }

  // ---- Anthropic (messages, tool_use) ---------------------------------------------------------------------------

  private async anthropic(input: AiCrmTurnInput): Promise<AiCrmTurnOutcome> {
    const base = this.baseUrl('AICRM_ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    const messages: Array<Record<string, unknown>> = input.history.map((h) => ({ role: h.role, content: h.text }));
    messages.push({ role: 'user', content: input.message });

    const tools = input.tools.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
    const actions: AiCrmExecutedAction[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const json = (await this.post(
        `${base}/v1/messages`,
        { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' },
        { model: input.model, max_tokens: MAX_TOKENS, system: input.systemPrompt, messages, tools },
      )) as {
        content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      promptTokens += num(json.usage?.input_tokens);
      completionTokens += num(json.usage?.output_tokens);
      const content = json.content ?? [];

      if (json.stop_reason !== 'tool_use') {
        const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        return { reply: text.trim() || 'Done.', actions, pendingWrite: null, promptTokens, completionTokens };
      }

      messages.push({ role: 'assistant', content });
      const results: Array<Record<string, unknown>> = [];
      for (const b of content) {
        if (b.type !== 'tool_use') continue;
        const name = b.name ?? '';
        const args = b.input ?? {};
        if (input.isWriteTool(name)) {
          return { reply: '', actions, pendingWrite: { tool: name, args }, promptTokens, completionTokens };
        }
        const result = await input.executeReadTool(name, args);
        actions.push({ tool: name, summary: result.summary });
        results.push({ type: 'tool_result', tool_use_id: b.id ?? '', content: JSON.stringify(result.data ?? result) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { reply: outOfStepsReply, actions, pendingWrite: null, promptTokens, completionTokens };
  }

  // ---- Gemini (generateContent, function-calling) ----------------------------------------------------------------

  private async gemini(input: AiCrmTurnInput): Promise<AiCrmTurnOutcome> {
    const base = this.baseUrl('AICRM_GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com');
    const contents: Array<Record<string, unknown>> = input.history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: input.message }] });

    const tools = [
      {
        function_declarations: input.tools.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })),
      },
    ];
    const actions: AiCrmExecutedAction[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const json = (await this.post(
        `${base}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
        { 'x-goog-api-key': input.apiKey },
        {
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents,
          tools,
          generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.2 },
        },
      )) as {
        candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      promptTokens += num(json.usageMetadata?.promptTokenCount);
      completionTokens += num(json.usageMetadata?.candidatesTokenCount);
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const fnCalls = parts.filter((p) => p.functionCall);

      if (fnCalls.length === 0) {
        const text = parts.map((p) => p.text ?? '').join('');
        return { reply: text.trim() || 'Done.', actions, pendingWrite: null, promptTokens, completionTokens };
      }

      contents.push({ role: 'model', parts });
      const responseParts: Array<Record<string, unknown>> = [];
      for (const p of fnCalls) {
        const name = p.functionCall?.name ?? '';
        const args = p.functionCall?.args ?? {};
        if (input.isWriteTool(name)) {
          return { reply: '', actions, pendingWrite: { tool: name, args }, promptTokens, completionTokens };
        }
        const result = await input.executeReadTool(name, args);
        actions.push({ tool: name, summary: result.summary });
        responseParts.push({ functionResponse: { name, response: toPlainObject(result.data ?? result) } });
      }
      // Gemini's generateContent protocol expects a turn carrying functionResponse parts to use role 'function'
      // (not 'user', unlike Anthropic's tool_result shape) — a wrong role here corrupts every multi-step turn.
      contents.push({ role: 'function', parts: responseParts });
    }
    return { reply: outOfStepsReply, actions, pendingWrite: null, promptTokens, completionTokens };
  }
}

const outOfStepsReply = 'I gathered the data but ran out of steps — please ask again more specifically.';

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

function toOpenAiTool(d: AiCrmToolDef): Record<string, unknown> {
  return { type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } };
}

function parseJsonArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toPlainObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : { value: v };
}
