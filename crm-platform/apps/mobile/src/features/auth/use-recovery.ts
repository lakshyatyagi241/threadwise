import {
  ERROR_CODES,
  findWorkspacesRequestSchema,
  forgotPasswordRequestSchema,
} from '@crm/contracts';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { requestPasswordReset, requestWorkspaceList } from './api';

/** Which mail the person is asking for: a reset link for a password, or the list of workspace addresses for an email. */
export type RecoveryKind = 'forgot' | 'find';

export interface RecoveryFieldErrors {
  workspace?: string;
  email?: string;
}

/**
 * The two "send me an email" doors of the sign-in screen (TW-AUTH-013 and the find-workspace page): checks the fields with the same
 * contract the API uses, sends the request, and says when it is done. The API answers the same whether or not the address belongs to
 * an account, so `done` means "asked", never "found".
 */
export function useRecovery(kind: RecoveryKind) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RecoveryFieldErrors>({});

  const submit = useCallback(
    async (workspace: string, email: string) => {
      setError(null);
      const body = { orgSlug: workspace.trim(), email: email.trim() };
      const parsed =
        kind === 'forgot'
          ? forgotPasswordRequestSchema.safeParse(body)
          : findWorkspacesRequestSchema.safeParse({ email: body.email });
      if (!parsed.success) {
        const failed = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
        const next: RecoveryFieldErrors = {};
        if (failed.has('orgSlug')) next.workspace = t('recovery.workspaceInvalid');
        if (failed.has('email')) next.email = t('auth.emailInvalid');
        setFieldErrors(next);
        return;
      }
      setFieldErrors({});
      setPending(true);
      try {
        if (kind === 'forgot') await requestPasswordReset(forgotPasswordRequestSchema.parse(body));
        else await requestWorkspaceList({ email: body.email });
        setDone(true);
      } catch (e) {
        // The platform asks for a CAPTCHA the app cannot produce yet (ADR-0023): say so, instead of a vague "something went wrong".
        setError(
          isApiError(e) && e.code === ERROR_CODES.AUTH_CAPTCHA_FAILED
            ? t('errors.captchaUnsupported')
            : messageForError(e, t),
        );
      } finally {
        setPending(false);
      }
    },
    [kind, t],
  );

  /** Back to the form (to use a different email). */
  const again = useCallback(() => {
    setDone(false);
    setError(null);
  }, []);

  return { pending, done, error, fieldErrors, submit, again };
}
