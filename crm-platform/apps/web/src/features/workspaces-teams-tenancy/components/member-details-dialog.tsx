'use client';

import { Button, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { WSP_CHAT_LIMIT_MAX, type WspMember } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { wspApi } from '../api/service';
import { validateDetails, type DetailsErrors } from '../lib/details-form';
import { dateTime } from '../lib/format';
import { ErrorNote } from './parts';

/**
 * "Change member": the phone number and the maximum concurrent chats of one member (Waboo's Users list columns). The last login
 * is shown, in the workspace time zone, and cannot be edited. Automatic assignment stops giving this agent chats once they hold
 * that many open ones; an empty limit means no limit.
 */
export function MemberDetailsDialog({
  member,
  onClose,
  onSaved,
}: {
  member: WspMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.details');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={tc('close')}
    >
      {/* Mounted per member, so each opening starts from what is stored. */}
      {member && (
        <DetailsForm key={member.id} member={member} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function DetailsForm({
  member,
  onClose,
  onSaved,
}: {
  member: WspMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.details');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const locale = useLocale();
  const session = useSession();
  const { toast } = useToast();
  const ids = useId();
  const [phone, setPhone] = useState(member.phone ?? '');
  const [chatLimit, setChatLimit] = useState(
    member.chatLimit === null ? '' : String(member.chatLimit),
  );
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lastLogin = dateTime(member.lastLoginAt, locale, session.org.timezone);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = validateDetails({ phone, chatLimit });
    if ('errors' in checked) {
      setErrors(checked.errors);
      document.getElementById(`${ids}-${checked.errors.phone ? 'phone' : 'chat-limit'}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await wspApi.updateDetails(member.id, {
        phone: checked.phone,
        chatLimit: checked.chatLimit,
        rowVersion: member.rowVersion,
      });
      toast(t('saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <p className="-mt-2 mb-1 text-xs text-muted-foreground">
        {t('intro', { name: member.fullName })}
      </p>
      <Field
        label={t('phone')}
        htmlFor={`${ids}-phone`}
        hint={t('phoneHint')}
        error={errors.phone ? t('phoneInvalid') : undefined}
      >
        <Input
          id={`${ids}-phone`}
          name="phone"
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setErrors((x) => ({ ...x, phone: undefined }));
          }}
          placeholder={t('phonePlaceholder')}
          maxLength={24}
          autoComplete="off"
          autoFocus
          invalid={Boolean(errors.phone)}
        />
      </Field>
      <Field
        label={t('chatLimit')}
        htmlFor={`${ids}-chat-limit`}
        hint={t('chatLimitHint')}
        error={errors.chatLimit ? t('chatLimitInvalid', { max: WSP_CHAT_LIMIT_MAX }) : undefined}
      >
        <Input
          id={`${ids}-chat-limit`}
          name="chatLimit"
          inputMode="numeric"
          value={chatLimit}
          onChange={(e) => {
            setChatLimit(e.target.value);
            setErrors((x) => ({ ...x, chatLimit: undefined }));
          }}
          placeholder={t('chatLimitPlaceholder')}
          maxLength={5}
          autoComplete="off"
          invalid={Boolean(errors.chatLimit)}
        />
      </Field>
      <Field label={t('lastLogin')} htmlFor={`${ids}-last-login`}>
        <Input
          id={`${ids}-last-login`}
          value={lastLogin ?? t('lastLoginNever')}
          readOnly
          data-testid="details-last-login"
        />
      </Field>
      {error !== null && <ErrorNote error={error} />}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {busy ? t('saving') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
