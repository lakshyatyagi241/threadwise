import { describe, expect, it } from 'vitest';
import { openAiTemperature } from '../../../src/infra/providers/openai-output-limit';

describe('openAiTemperature', () => {
  it('leaves the temperature out for the GPT-5 family and the reasoning models on OpenAI itself', () => {
    for (const m of [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5.4-mini',
      'gpt-5.6-pro',
      'o1',
      'o3-mini',
      'o4-mini',
    ])
      expect(openAiTemperature(m, 0.7, true), m).toEqual({});
  });
  it('keeps it for the other OpenAI models, gpt-5-chat, and any gateway or vendor', () => {
    expect(openAiTemperature('gpt-4o-mini', 0.7, true)).toEqual({ temperature: 0.7 });
    expect(openAiTemperature('gpt-5-chat-latest', 0.7, true)).toEqual({ temperature: 0.7 });
    expect(openAiTemperature('gpt-5.4-mini', 0.7, false)).toEqual({ temperature: 0.7 });
    expect(openAiTemperature('o3-mini', 0.2, false)).toEqual({ temperature: 0.2 });
  });
});
