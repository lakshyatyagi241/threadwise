'use client';

import { Alert, Button, Field, Input, Modal, Select, Spinner, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import {
  WSP_MEMBER_NAME_MAX,
  type InviteWspMemberResponse,
  type WspMembersSummary,
} from '@crm/contracts';
import { wspApi } from '../api/service';
import {
  grantableRoles,
  validateInvite,
  type InviteErrors,
  type InviteForm,
} from '../lib/invite-form';
import { CopyField, ErrorNote, INVITE_DAYS } from './parts';

const blank = (roleId: string): InviteForm => ({ fullName: '', email: '', roleId });

/**
 * "Invite teammate" (WD-WSP-016). The role list is what the caller may grant (the summary's `grantable` roles). The
 * result stays in the dialog like WaDesk's: a sent invite says so, and without a mail transport the one-time link is
 * shown with a Copy button (WaDesk showed a temp password here; ours never exists).
 */
export function InviteDialog({
  open,
  roles,
  onClose,
  onInvited,
}: {
  open: boolean;
  roles: WspMembersSummary['roles'];
  onClose: () => void;
  onInvited: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.invite');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={tc('close')}
    >
      {/* Mounted only while open, so every opening starts from a blank form. */}
      {open && <InviteForm roles={roles} onClose={onClose} onInvited={onInvited} />}
    </Modal>
  );
}

function InviteForm({
  roles,
  onClose,
  onInvited,
}: {
  roles: WspMembersSummary['roles'];
  onClose: () => void;
  onInvited: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.invite');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const options = grantableRoles(roles);
  const ids = useId();
  const [form, setForm] = useState<InviteForm>(blank(options[0]?.id ?? ''));
  const [fieldErrors, setFieldErrors] = useState<InviteErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<InviteWspMemberResponse | null>(null);

  const set = (patch: Partial<InviteForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFieldErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof InviteErrors];
      return next;
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = validateInvite(form);
    if ('errors' in checked) {
      setFieldErrors(checked.errors);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await wspApi.invite(checked.input);
      setResult(res);
      setForm((f) => ({ ...blank(f.roleId) }));
      onInvited();
      toast(t('toast'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const nameError = fieldErrors.fullName
    ? fieldErrors.fullName === 'tooLong'
      ? t('nameTooLong', { max: WSP_MEMBER_NAME_MAX })
      : t('nameRequired')
    : undefined;
  const emailError = fieldErrors.email
    ? fieldErrors.email === 'required'
      ? t('emailRequired')
      : t('emailInvalid')
    : undefined;

  return (
    <>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">{t('intro')}</p>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
        <Field label={t('name')} htmlFor={`${ids}-name`} error={nameError}>
          <Input
            id={`${ids}-name`}
            name="fullName"
            value={form.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
            placeholder={t('namePlaceholder')}
            maxLength={WSP_MEMBER_NAME_MAX}
            autoComplete="off"
            autoFocus
            invalid={Boolean(nameError)}
          />
        </Field>
        <Field label={t('email')} htmlFor={`${ids}-email`} error={emailError}>
          <Input
            id={`${ids}-email`}
            name="email"
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder={t('emailPlaceholder')}
            maxLength={191}
            autoComplete="off"
            invalid={Boolean(emailError)}
          />
        </Field>
        <Field label={t('role')} htmlFor={`${ids}-role`}>
          <Select
            id={`${ids}-role`}
            name="roleId"
            value={form.roleId}
            onChange={(e) => set({ roleId: e.target.value })}
          >
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.tier === 'custom' ? r.name : t(`roleOptions.${r.tier}`)}
              </option>
            ))}
          </Select>
        </Field>

        {result && (
          <Alert
            tone="success"
            className="space-y-1.5 !text-foreground"
            data-testid="invite-result"
          >
            <div className="font-semibold">{t('added', { name: result.member.fullName })}</div>
            {result.emailSent ? (
              <p className="text-xs">
                {t('emailed', { email: result.member.email, days: INVITE_DAYS })}
              </p>
            ) : (
              <>
                <p className="text-xs">{t('shareLink')}</p>
                {result.inviteLink && (
                  <CopyField label={t('shareLink')} value={result.inviteLink} />
                )}
              </>
            )}
          </Alert>
        )}
        {error !== null && <ErrorNote error={error} />}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {result ? t('done') : tc('cancel')}
          </Button>
          <Button type="submit" disabled={busy || options.length === 0}>
            {busy && <Spinner />}
            {busy ? t('sending') : t('submit')}
          </Button>
        </div>
      </form>
    </>
  );
}
