import type { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

/** The translator of the `flb.builder.shell.aiError` namespace. */
export type AiErrorTranslate = ReturnType<typeof useTranslations>;

const FIELD_LABEL_KEY: Record<string, string> = {
  prompt: 'fieldPrompt',
  model: 'fieldModel',
  provider: 'fieldProvider',
  flowType: 'fieldFlowType',
};
const MAX: Record<string, number> = { prompt: 2000, model: 120 };

/**
 * The inline error of the Generate-with-AI modal. WaDesk shows the server's `message` (`no_key`, `provider_failed`,
 * `bad_json` carry readable text) and, for a rejected request, Laravel's validation sentence; ours answers problem+json with
 * a generic detail, so a validation failure is worded from its first field error the way Laravel words it.
 * `t` is the translator of `flb.builder.shell.aiError`.
 */
export function aiGenerateError(e: unknown, t: AiErrorTranslate): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_FAILED' && e.fieldErrors.length > 0) {
      const f = e.fieldErrors[0]!;
      const labelKey = FIELD_LABEL_KEY[f.path];
      const label = labelKey ? t(labelKey) : f.path;
      if (/at most|too_big|too long/i.test(f.message) && MAX[f.path])
        return t('tooLong', { label, max: String(MAX[f.path]) });
      if (/at least|required|too_small|empty/i.test(f.message)) return t('required', { label });
      return t('invalid', { label });
    }
    // The request layer words an unreadable failure itself ("Generation failed (504)"): show it in the viewer's language.
    if (e.code === 'INTERNAL' || e.code === 'UNKNOWN')
      return t('generationFailed', { status: String(e.status) });
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : t('network');
}
