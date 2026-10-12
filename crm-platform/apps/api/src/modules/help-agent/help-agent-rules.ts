import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { HelpAgentChatMessage } from '../../infra/providers/help-agent/help-agent-llm.port';

/**
 * Pure rules of the Help assistant (docs/specs/help-agent-assistant.md sections 6.5 and 8), kept free of the database and the network so
 * each one can be tested alone.
 */

export interface RequestLimits {
  maxChars: number;
}

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);
/** The model call has one macro tool and a few more at most; a long list is not the assistant talking. */
const MAX_TOOLS = 16;
const MAX_MESSAGES = 40;
const MAX_TOOLS_CHARS = 40_000;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** What the proxy sends on: the only parts of the browser's request it trusts. */
export interface SanitisedCompletion {
  messages: HelpAgentChatMessage[];
  tools: unknown[];
  toolChoice: unknown;
}

const bad = (message: string): AppError =>
  new AppError(ERROR_CODES.HELP_AGENT_REQUEST_INVALID, message, HttpStatus.BAD_REQUEST);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turns the browser's request into the one shape the proxy forwards. Everything not named here is dropped (the model, the output size
 * and the sampling are the server's to choose), a stream is refused, and the size is bounded. The caller never learns more than "invalid".
 */
export function sanitiseCompletionRequest(
  body: unknown,
  limits: RequestLimits,
): SanitisedCompletion {
  if (!isRecord(body)) throw bad('The request must be a JSON object.');
  if (body.stream === true) throw bad('Streaming is not supported.');

  const rawMessages = body.messages;
  if (
    !Array.isArray(rawMessages) ||
    rawMessages.length === 0 ||
    rawMessages.length > MAX_MESSAGES
  ) {
    throw bad('The request needs between 1 and 40 messages.');
  }
  let chars = 0;
  const messages: HelpAgentChatMessage[] = rawMessages.map((m): HelpAgentChatMessage => {
    if (!isRecord(m) || typeof m.role !== 'string' || !ROLES.has(m.role)) {
      throw bad('A message has an unknown role.');
    }
    const content = m.content;
    if (content !== undefined && content !== null && typeof content !== 'string') {
      throw bad('A message has content that is not text.');
    }
    if (typeof content === 'string') chars += content.length;
    const out: HelpAgentChatMessage = { role: m.role as HelpAgentChatMessage['role'] };
    if (content !== undefined) out.content = content;
    if (Array.isArray(m.tool_calls)) {
      chars += JSON.stringify(m.tool_calls).length;
      out.tool_calls = m.tool_calls;
    }
    if (typeof m.tool_call_id === 'string') out.tool_call_id = m.tool_call_id.slice(0, 200);
    if (typeof m.name === 'string') out.name = m.name.slice(0, 64);
    return out;
  });
  if (chars > limits.maxChars) throw bad('The request is too large.');

  const rawTools = body.tools;
  let tools: unknown[] = [];
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools) || rawTools.length > MAX_TOOLS) throw bad('Too many tools.');
    if (JSON.stringify(rawTools).length > MAX_TOOLS_CHARS) throw bad('The tool list is too large.');
    tools = rawTools.map((t) => {
      const fn = isRecord(t) && isRecord(t.function) ? t.function : null;
      if (
        !isRecord(t) ||
        t.type !== 'function' ||
        !fn ||
        typeof fn.name !== 'string' ||
        !TOOL_NAME.test(fn.name)
      ) {
        throw bad('A tool is not a function tool with a plain name.');
      }
      return t;
    });
  }

  return { messages, tools, toolChoice: sanitiseToolChoice(body.tool_choice, tools.length > 0) };
}

function sanitiseToolChoice(raw: unknown, hasTools: boolean): unknown {
  if (!hasTools) return undefined;
  if (raw === 'required' || raw === 'auto' || raw === 'none') return raw;
  if (isRecord(raw) && raw.type === 'function' && isRecord(raw.function)) {
    const name = raw.function.name;
    if (typeof name === 'string' && TOOL_NAME.test(name)) {
      return { type: 'function', function: { name } };
    }
  }
  return 'required';
}

/** Whether an open task has outlived its time (it is then closed to further calls). */
export function taskExpired(startedAt: Date, now: Date, minutes: number): boolean {
  return now.getTime() - startedAt.getTime() > minutes * 60_000;
}

/** The start of the rolling windows the caps count over. */
export const windowStart = (now: Date, ms: number): Date => new Date(now.getTime() - ms);
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 3_600_000;

/** The locale the task reports: a plain language tag, else `en`. */
export function normalLocale(raw: string): string {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(raw) ? raw : 'en';
}

/** Whole non-negative number, bounded. */
export const clampCount = (n: number, max = 1000): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(0, Math.trunc(n))) : 0;

/** A page path with the query and hash removed, bounded. Only a path that starts with a slash is kept. */
export function normalRoute(raw: string): string | null {
  const bare = (raw.split(/[?#]/)[0] ?? '').trim();
  if (!bare.startsWith('/') || bare.startsWith('//')) return null;
  return bare.slice(0, 200);
}
