import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { aiGenerateError } from './ai-generate-error';

const validation = (path: string, message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', 'Request payload failed validation', undefined, [
    { path, message },
  ]);

describe('Generate with AI inline error', () => {
  it('shows the server message of the three provider states as is', () => {
    const noKey =
      'Admin has not enabled this provider in /admin/api-keys. Pick another provider or contact your admin.';
    expect(aiGenerateError(new ApiError(422, 'FLB_AI_NO_KEY', noKey))).toBe(noKey);
    expect(
      aiGenerateError(
        new ApiError(
          502,
          'FLB_AI_PROVIDER_FAILED',
          'AI provider returned no content — check API key + model id.',
        ),
      ),
    ).toBe('AI provider returned no content — check API key + model id.');
    expect(
      aiGenerateError(
        new ApiError(
          422,
          'FLB_AI_BAD_JSON',
          'Model output was not valid flow JSON. Try a clearer prompt.',
        ),
      ),
    ).toBe('Model output was not valid flow JSON. Try a clearer prompt.');
  });

  it('a non-problem failure reads "Generation failed (<status>)" (built by the API call) and keeps its text', () => {
    expect(aiGenerateError(new ApiError(504, 'INTERNAL', 'Generation failed (504)'))).toBe(
      'Generation failed (504)',
    );
  });

  it('words a rejected request like Laravel does: Mistral is pickable but not accepted (QUIRK), long and empty prompts', () => {
    expect(
      aiGenerateError(
        validation(
          'provider',
          "Invalid enum value. Expected 'openai' | 'anthropic' | 'gemini', received 'mistral'",
        ),
      ),
    ).toBe('The selected provider is invalid.');
    expect(
      aiGenerateError(validation('prompt', 'String must contain at most 2000 character(s)')),
    ).toBe('The prompt may not be greater than 2000 characters.');
    expect(
      aiGenerateError(validation('prompt', 'String must contain at least 1 character(s)')),
    ).toBe('The prompt field is required.');
    expect(aiGenerateError(validation('flowType', 'Invalid enum value'))).toBe(
      'The selected flow type is invalid.',
    );
  });

  it('a network failure shows the browser message, else "Network error"', () => {
    expect(aiGenerateError(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(aiGenerateError('boom')).toBe('Network error');
  });
});
