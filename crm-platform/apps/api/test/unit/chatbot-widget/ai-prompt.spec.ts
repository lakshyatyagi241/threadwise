import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDOFF,
  DEFAULT_PERSONA,
  fullSystemPrompt,
  knowledgeContext,
  systemPrompt,
  userPrompt,
} from '../../../src/modules/chatbot-widget/ai-prompt';
import type {
  AssistantProfile,
  InboxLine,
  KnowledgeSource,
} from '../../../src/modules/chatbot-widget/_shims/tokens';

const assistant = (over: Partial<AssistantProfile> = {}): AssistantProfile => ({
  id: 1,
  uuid: 'u',
  name: 'Bot',
  systemPrompt: null,
  tone: null,
  language: null,
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  replyMaxTokens: null,
  temperature: null,
  fallbackMessage: null,
  handoffEnabled: true,
  handoffKeyword: null,
  handoffMessage: null,
  ...over,
});

const src = (label: string, content: string, kind = 'text'): KnowledgeSource => ({
  label,
  kind,
  content,
  question: null,
  answer: null,
});

describe('system prompt (WD-WGT-016 #2)', () => {
  it('WD-WGT-016: defaults to the website-chatbot persona, helpful tone and English', () => {
    const p = systemPrompt(assistant());
    expect(p.startsWith(`${DEFAULT_PERSONA}\n`)).toBe(true);
    expect(p).toContain('Speak in a helpful tone. Default language: en.');
    expect(p).toContain('Keep replies short');
    expect(p).not.toContain('talk to a human');
  });

  it('WD-WGT-016: the handoff hint needs the switch AND a keyword; the message defaults to "A team member will join shortly."', () => {
    const on = systemPrompt(assistant({ handoffKeyword: 'human' }));
    expect(on).toContain('says "human"');
    expect(on).toContain(DEFAULT_HANDOFF);
    expect(
      systemPrompt(assistant({ handoffKeyword: 'human', handoffMessage: 'Hold on' })),
    ).toContain('reply with: Hold on');
    expect(
      systemPrompt(assistant({ handoffKeyword: 'human', handoffEnabled: false })),
    ).not.toContain('human');
  });

  it('WD-WGT-016: persona, tone and language come from the assistant', () => {
    const p = systemPrompt(
      assistant({ systemPrompt: ' You sell shoes. ', tone: 'warm', language: 'es' }),
    );
    expect(p.startsWith('You sell shoes.\n')).toBe(true);
    expect(p).toContain('warm tone. Default language: es.');
  });

  it('WD-WGT-016 #3: a reply-language hint is appended only when there is one', () => {
    expect(fullSystemPrompt(assistant(), [], null)).not.toContain('language code');
    expect(fullSystemPrompt(assistant(), [], 'es')).toContain(
      'The visitor is writing in language code "es". Reply ENTIRELY in that same language',
    );
  });
});

describe('knowledge base (WD-WGT-016 #2)', () => {
  it('WD-WGT-016: sources are labelled and joined in order between the knowledge markers', () => {
    const ctx = knowledgeContext([src('Shipping', 'Free over 50'), src('Returns', '30 days')]);
    expect(ctx).toBe('[Shipping]\nFree over 50\n\n[Returns]\n30 days');
    const full = fullSystemPrompt(assistant(), [src('A', 'b')], null);
    expect(full).toContain('--- Knowledge base ---\n[A]\nb\n--- End knowledge base ---');
  });

  it('WD-WGT-016: a Q and A source renders as Q: / A:, an empty source is skipped', () => {
    const qa: KnowledgeSource = {
      label: 'FAQ',
      kind: 'qa',
      content: null,
      question: ' Open? ',
      answer: ' Yes ',
    };
    expect(knowledgeContext([qa, src('Empty', '   ')])).toBe('[FAQ]\nQ: Open?\nA: Yes');
  });

  it('WD-WGT-016: the whole knowledge base is capped near 12,000 characters', () => {
    const big = Array.from({ length: 10 }, (_, i) => src(`S${i}`, 'x'.repeat(5_000)));
    const ctx = knowledgeContext(big);
    expect(ctx.length).toBeLessThanOrEqual(12_000 + 500 + 40);
    expect(ctx).toContain('[S0]');
    expect(ctx).not.toContain('[S9]');
  });
});

describe('user prompt (WD-WGT-016 #4)', () => {
  const line = (id: number, direction: string, body: string): InboxLine => ({
    id,
    direction,
    body,
    agentId: null,
    sentAt: null,
  });

  it('WD-WGT-016: history labels inbound Visitor and every outbound Assistant, then the new message', () => {
    const p = userPrompt(
      [line(1, 'in', 'hi'), line(2, 'out', 'hello'), line(3, 'out', 'from a person')],
      ' price? ',
    );
    expect(p).toBe(
      'Conversation so far:\nVisitor: hi\nAssistant: hello\nAssistant: from a person\n\n' +
        'Visitor just said:\nprice?\n\nReply briefly and helpfully. Plain text only, no role prefix.',
    );
  });

  it('WD-WGT-016: with no history there is no "Conversation so far" block', () => {
    expect(userPrompt([], 'hi')).toBe(
      'Visitor just said:\nhi\n\nReply briefly and helpfully. Plain text only, no role prefix.',
    );
  });

  it('WD-WGT-016: history stops once 6,000 characters are used', () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(i, 'in', 'y'.repeat(1_000)));
    const p = userPrompt(lines, 'now');
    const used = (p.match(/Visitor: /g) ?? []).length;
    expect(used).toBeLessThanOrEqual(7);
    expect(used).toBeGreaterThanOrEqual(5);
  });
});
