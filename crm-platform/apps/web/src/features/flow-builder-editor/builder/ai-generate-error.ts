import { ApiError } from '@/lib/api/errors';

const FIELD_LABEL: Record<string, string> = { prompt: 'prompt', model: 'model', provider: 'provider', flowType: 'flow type' };
const MAX: Record<string, number> = { prompt: 2000, model: 120 };

/**
 * The inline error of the Generate-with-AI modal. WaDesk shows the server's `message` (`no_key`, `provider_failed`,
 * `bad_json` carry readable text) and, for a rejected request, Laravel's validation sentence; ours answers problem+json with
 * a generic detail, so a validation failure is worded from its first field error the way Laravel words it.
 */
export function aiGenerateError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_FAILED' && e.fieldErrors.length > 0) {
      const f = e.fieldErrors[0]!;
      const label = FIELD_LABEL[f.path] ?? f.path;
      if (/at most|too_big|too long/i.test(f.message) && MAX[f.path])
        return `The ${label} may not be greater than ${MAX[f.path]} characters.`;
      if (/at least|required|too_small|empty/i.test(f.message)) return `The ${label} field is required.`;
      return `The selected ${label} is invalid.`;
    }
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : 'Network error';
}
