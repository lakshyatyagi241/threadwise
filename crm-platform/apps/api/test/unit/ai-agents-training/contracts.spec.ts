import { describe, expect, it } from 'vitest';
import {
  addAiagSourceSchema,
  createAiagAssistantSchema,
  saveAiagResponderSchema,
  updateAiagAssistantSchema,
} from '@crm/contracts';

describe('AI Training contracts (TW-AIAG-002, 005)', () => {
  it("text is cut at Reference's 200 000 characters in the schema (the request body cap may be lower)", () => {
    const ok = addAiagSourceSchema.safeParse({
      kind: 'text',
      label: 'L',
      content: 'x'.repeat(200_000),
    });
    const over = addAiagSourceSchema.safeParse({
      kind: 'text',
      label: 'L',
      content: 'x'.repeat(200_001),
    });
    expect(ok.success).toBe(true);
    expect(over.success).toBe(false);
  });

  it('a Q&A needs both sides and trims the label', () => {
    expect(
      addAiagSourceSchema.safeParse({ kind: 'qa', label: ' L ', question: 'Q', answer: '' })
        .success,
    ).toBe(false);
    const ok = addAiagSourceSchema.parse({ kind: 'qa', label: ' L ', question: 'Q', answer: 'A' });
    expect(ok.label).toBe('L');
  });

  it('the assistant form turns blank optional text into null and rejects unknown fields', () => {
    const parsed = createAiagAssistantSchema.parse({
      name: ' Bot ',
      greeting: '   ',
      fallbackMessage: '',
    });
    expect(parsed).toMatchObject({ name: 'Bot', greeting: null, fallbackMessage: null });
    expect(createAiagAssistantSchema.safeParse({ name: 'Bot', slug: 'x' }).success).toBe(false);
  });

  it('an update needs the row version it was read at', () => {
    expect(updateAiagAssistantSchema.safeParse({ name: 'Bot' }).success).toBe(false);
    expect(updateAiagAssistantSchema.safeParse({ name: 'Bot', rowVersion: 3 }).success).toBe(true);
  });

  it('the responder mode is one of the three; the switch defaults to off', () => {
    expect(saveAiagResponderSchema.parse({ mode: 'meta_agent_only' })).toEqual({
      mode: 'meta_agent_only',
      metaAgentEnabled: false,
    });
    expect(saveAiagResponderSchema.safeParse({ mode: 'someone_else' }).success).toBe(false);
  });
});
