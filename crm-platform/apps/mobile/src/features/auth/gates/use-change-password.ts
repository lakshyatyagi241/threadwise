import { ERROR_CODES } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { sessionKey } from '@/lib/session/use-session';
import { changePassword } from './gates-api';
import { checkPassword, type PolicyParts } from '@/features/auth/password-rules';
import { policyMessage } from '@/features/auth/sign-up-errors';

export interface PasswordFieldErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/**
 * Choosing a new password on the forced-change lock screen (TW-AUTH-035). The checks mirror the web form (the current password, the
 * workspace's rules, the two entries matching); the server decides in the end and names the rule or field it refused. When it is done
 * the session is read again, its flag has cleared, and the lock screen goes away by itself.
 */
export function useChangePassword() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});

  const submit = useCallback(
    async (current: string, next: string, confirm: string, parts: PolicyParts) => {
      setBanner(null);
      const errors: PasswordFieldErrors = {};
      if (!current) errors.current = t('gates.password.currentRequired');
      if (!checkPassword(next, parts).every((rule) => rule.met)) {
        errors.next = t('signUp.validation.passwordInvalid');
      } else if (next === current) {
        errors.next = t('gates.password.sameAsCurrent');
      }
      if (next !== confirm) errors.confirm = t('gates.password.mismatch');
      setFieldErrors(errors);
      if (errors.current || errors.next || errors.confirm) return;

      setPending(true);
      try {
        await changePassword({ currentPassword: current, newPassword: next });
        await queryClient.invalidateQueries({ queryKey: sessionKey });
      } catch (e) {
        if (isApiError(e) && e.code === ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG) {
          setFieldErrors({ current: t('gates.password.currentWrong') });
        } else if (isApiError(e) && e.code === ERROR_CODES.AUTH_PASSWORD_POLICY) {
          setFieldErrors({ next: policyMessage(e, t, 'newPassword') });
        } else if (
          isApiError(e) &&
          e.code === ERROR_CODES.VALIDATION_FAILED &&
          e.fieldErrors.some((d) => d.path === 'newPassword')
        ) {
          // The only rule the server names here that the form did not already check is "not the password you have now".
          setFieldErrors({ next: t('gates.password.sameAsCurrent') });
        } else {
          setBanner(messageForError(e, t));
        }
      } finally {
        setPending(false);
      }
    },
    [queryClient, t],
  );

  return { submit, pending, banner, fieldErrors };
}
