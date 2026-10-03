import { describe, expect, it } from 'vitest';
import {
  appendTurn,
  conversationPrompt,
  extractionSuffix,
  historyOf,
  providerOfModel,
  replyVariables,
  transcriptVariables,
  tryParseJson,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ai-rules';

describe('flow AI node rules (WD-FLR-030)', () => {
  it('infers the vendor from the model name, OpenAI by default', () => {
    expect(providerOfModel('gpt-4o-mini')).toBe('openai');
    expect(providerOfModel('Claude-3-5-sonnet')).toBe('anthropic');
    expect(providerOfModel('gemini-1.5-pro')).toBe('gemini');
    expect(providerOfModel('open-mixtral-8x7b')).toBe('mistral');
    expect(providerOfModel('ministral-3b')).toBe('mistral');
    expect(providerOfModel('something-else')).toBe('openai');
  });

  it('reads JSON bare, fenced, or inside prose, and null otherwise', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(tryParseJson('Sure! Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
    expect(tryParseJson('no json here')).toBeNull();
    expect(tryParseJson(undefined)).toBeNull();
  });

  it('keeps the raw reply and spreads a JSON object into <var>.<field>', () => {
    const v = replyVariables('reply', '{"NAME":"Asha","qty":2,"tags":["a"],"note":null}');
    expect(v.reply).toBe('{"NAME":"Asha","qty":2,"tags":["a"],"note":null}');
    expect(v['reply.NAME']).toBe('Asha');
    expect(v['reply.qty']).toBe('2');
    expect(v['reply.tags']).toBe('["a"]');
    expect(v['reply.note']).toBe('');
  });

  it('puts every record of an array reply under __rows and spreads the first', () => {
    const v = replyVariables('r', '[{"a":"1"},{"a":"2"}]');
    expect(v['r.__rows']).toEqual([{ a: '1' }, { a: '2' }]);
    expect(v['r.a']).toBe('1');
  });

  it('promotes the first list of records of a wrapped object to __rows', () => {
    const v = replyVariables('r', '{"rows":[{"a":"1"},{"a":"2"}],"count":2}');
    expect(v['r.__rows']).toEqual([{ a: '1' }, { a: '2' }]);
    expect(v['r.count']).toBe('2');
  });

  it('keeps only the single variable for a plain-text reply', () => {
    expect(replyVariables('reply', 'Hello there')).toEqual({ reply: 'Hello there' });
  });

  it('builds the extraction suffix with the key list', () => {
    expect(extractionSuffix(['NAME', ' PHONE '])).toContain('exactly these keys: NAME, PHONE');
    expect(extractionSuffix([])).not.toContain('exactly these keys');
  });

  it('folds the last ten turns into the conversation prompt', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      content: `m${i}`,
    }));
    const p = conversationPrompt(history, 'latest');
    expect(p).toContain('Conversation so far:');
    expect(p).not.toContain('m3');
    expect(p).toContain('Customer: m4');
    expect(p).toContain('Assistant: m13');
    expect(p).toContain('Customer: latest');
    expect(conversationPrompt([], 'first')).toBe('first');
  });

  it('keeps the last 20 turns and cuts long messages', () => {
    let h: ReturnType<typeof appendTurn> = [];
    for (let i = 0; i < 15; i++) h = appendTurn(h, `u${i}`, 'x'.repeat(3000));
    expect(h).toHaveLength(20);
    expect(h[1]!.content).toHaveLength(2000);
    expect(appendTurn([], '', 'hi')).toEqual([{ role: 'assistant', content: 'hi' }]);
  });

  it('reads a hand-edited history safely', () => {
    expect(
      historyOf({ history: [{ role: 'user', content: 'a' }, 7, null, { content: 'b' }] }),
    ).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(historyOf(undefined)).toEqual([]);
  });

  it('maps an exit extraction to field variables plus the raw text, objects only', () => {
    expect(transcriptVariables('reply', '{"NAME":"Asha"}')).toEqual({
      'reply.NAME': 'Asha',
      reply: '{"NAME":"Asha"}',
    });
    expect(transcriptVariables('reply', '[1]')).toBeNull();
    expect(transcriptVariables('reply', 'nope')).toBeNull();
  });
});
