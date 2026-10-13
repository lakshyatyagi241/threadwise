import { describe, expect, it } from 'vitest';
import { ERROR_CODES, isHelpAgentNavBlocked, isHelpAgentRouteDisabled } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  clampCount,
  normalLocale,
  normalRoute,
  sanitiseCompletionRequest,
  taskExpired,
} from '../../../src/modules/help-agent/help-agent-rules';

const limits = { maxChars: 10_000 };
const tool = {
  type: 'function',
  function: { name: 'AgentOutput', parameters: { type: 'object' } },
};
const ok = {
  model: 'gpt-evil',
  messages: [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'page text' },
  ],
  tools: [tool],
  tool_choice: { type: 'function', function: { name: 'AgentOutput' } },
  parallel_tool_calls: true,
  max_tokens: 999_999,
  temperature: 2,
  user: 'someone',
};

const invalid = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.HELP_AGENT_REQUEST_INVALID);
    return;
  }
  throw new Error('expected the request to be refused');
};

describe('help agent: the model request the proxy forwards', () => {
  it('keeps messages, tools and tool_choice and drops everything the server owns', () => {
    const out = sanitiseCompletionRequest(ok, limits);
    expect(Object.keys(out).sort()).toEqual(['messages', 'toolChoice', 'tools']);
    expect(out.messages).toHaveLength(2);
    expect(out.tools).toHaveLength(1);
    expect(out.toolChoice).toEqual({ type: 'function', function: { name: 'AgentOutput' } });
    // model, max_tokens, temperature, parallel_tool_calls and user never reach the vendor call
    expect(JSON.stringify(out)).not.toContain('gpt-evil');
    expect(JSON.stringify(out)).not.toContain('999999');
  });

  it('refuses a stream, a non-object body and an empty or oversized message list', () => {
    invalid(() => sanitiseCompletionRequest({ ...ok, stream: true }, limits));
    invalid(() => sanitiseCompletionRequest('x', limits));
    invalid(() => sanitiseCompletionRequest([], limits));
    invalid(() => sanitiseCompletionRequest({ ...ok, messages: [] }, limits));
    invalid(() =>
      sanitiseCompletionRequest(
        { ...ok, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) },
        limits,
      ),
    );
  });

  it('refuses an unknown role and content that is not text', () => {
    invalid(() =>
      sanitiseCompletionRequest({ ...ok, messages: [{ role: 'god', content: 'x' }] }, limits),
    );
    invalid(() =>
      sanitiseCompletionRequest({ ...ok, messages: [{ role: 'user', content: { a: 1 } }] }, limits),
    );
    invalid(() =>
      sanitiseCompletionRequest(
        {
          ...ok,
          messages: [
            { role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://x' } }] },
          ],
        },
        limits,
      ),
    );
  });

  it('bounds the total size of the messages', () => {
    invalid(() =>
      sanitiseCompletionRequest(
        { ...ok, messages: [{ role: 'user', content: 'x'.repeat(10_001) }] },
        limits,
      ),
    );
    expect(() =>
      sanitiseCompletionRequest(
        { ...ok, messages: [{ role: 'user', content: 'x'.repeat(10_000) }] },
        limits,
      ),
    ).not.toThrow();
  });

  it('accepts only function tools with plain names, and not too many', () => {
    invalid(() => sanitiseCompletionRequest({ ...ok, tools: [{ type: 'retrieval' }] }, limits));
    invalid(() =>
      sanitiseCompletionRequest(
        { ...ok, tools: [{ type: 'function', function: { name: 'a b; drop' } }] },
        limits,
      ),
    );
    invalid(() =>
      sanitiseCompletionRequest({ ...ok, tools: Array.from({ length: 17 }, () => tool) }, limits),
    );
  });

  it('turns a strange tool_choice into "required" and drops it when there are no tools', () => {
    expect(sanitiseCompletionRequest({ ...ok, tool_choice: { evil: 1 } }, limits).toolChoice).toBe(
      'required',
    );
    expect(sanitiseCompletionRequest({ ...ok, tool_choice: 'auto' }, limits).toolChoice).toBe(
      'auto',
    );
    expect(
      sanitiseCompletionRequest({ ...ok, tools: undefined }, limits).toolChoice,
    ).toBeUndefined();
  });
});

describe('help agent: small rules', () => {
  it('expires a task after its minutes', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(taskExpired(start, new Date('2026-01-01T10:14:59Z'), 15)).toBe(false);
    expect(taskExpired(start, new Date('2026-01-01T10:15:01Z'), 15)).toBe(true);
  });

  it('keeps a plain locale tag and a plain path only', () => {
    expect(normalLocale('ar')).toBe('ar');
    expect(normalLocale('zh-CN')).toBe('zh-CN');
    expect(normalLocale('<script>')).toBe('en');
    expect(normalRoute('/contacts?x=1#top')).toBe('/contacts');
    expect(normalRoute('https://evil.test/')).toBeNull();
    expect(normalRoute('//evil.test')).toBeNull();
  });

  it('clamps counts', () => {
    expect(clampCount(-4)).toBe(0);
    expect(clampCount(7.9)).toBe(7);
    expect(clampCount(10 ** 9)).toBe(1000);
    expect(clampCount(Number.NaN)).toBe(0);
  });
});

describe('help agent: where it is off', () => {
  it.each([
    '/inbox',
    '/inbox/123',
    '/inbox/message-logs',
    '/team-chat',
    '/team-chat/x',
    '/support/42',
    '/admin',
    '/platform/x',
  ])('is disabled on %s', (path) => {
    expect(isHelpAgentRouteDisabled(path)).toBe(true);
    expect(isHelpAgentNavBlocked(path)).toBe(true);
  });

  it.each(['/contacts', '/settings/channels', '/inbox-tools', '/help'])(
    'is allowed on %s',
    (path) => {
      expect(isHelpAgentRouteDisabled(path)).toBe(false);
    },
  );

  it.each(['/api/v2/x', '/login', '/logout', '/impersonate', '/b/shop', '/docs'])(
    'blocks navigation to %s',
    (path) => {
      expect(isHelpAgentNavBlocked(path)).toBe(true);
    },
  );

  it('matches whole path segments and ignores the query', () => {
    expect(isHelpAgentRouteDisabled('/inbox?x=1')).toBe(true);
    expect(isHelpAgentRouteDisabled('/INBOX')).toBe(true);
    expect(isHelpAgentRouteDisabled('/inboxes')).toBe(false);
  });
});
