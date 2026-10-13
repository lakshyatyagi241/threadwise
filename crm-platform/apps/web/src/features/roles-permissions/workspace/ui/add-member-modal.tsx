'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  inviteWspMemberSchema,
  type InviteWspMemberResponse,
  type RoleResponse,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { inviteWspMemberResponseSchema } from '@crm/contracts';
import { wsKeys } from '../lib/api';
import { wsError, type WsError } from '../lib/errors';
import { presetSlug } from '../lib/members';

const NS = 'roles-permissions-workspace.team.add';
type FieldName = 'fullName' | 'email' | 'roleId';

/** The default role: Agent when the caller may grant it (Reference's default), otherwise the first grantable role. */
const defaultRoleId = (roles: readonly RoleResponse[]) =>
  (roles.find((r) => presetSlug(r.systemKey) === 'agent') ?? roles[0])?.id ?? '';

export function AddMemberModal({
  roles,
  onClose,
  onCreated,
}: {
  /** Only roles the caller may grant. */
  roles: readonly RoleResponse[];
  onClose: () => void;
  onCreated: (name: string, emailSent: boolean) => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const tc = useTranslations('roles-permissions-workspace.common');
  const tr = useTranslations('roles-permissions-workspace.blurb');
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(() => defaultRoleId(roles));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, ReactNode>>>({});
  const [serverError, setServerError] = useState<WsError | null>(null);
  const [sent, setSent] = useState<InviteWspMemberResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/workspace/members/invite', {
        method: 'POST',
        body: { fullName: fullName.trim(), email: email.trim(), roleId },
        schema: inviteWspMemberResponseSchema,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: wsKeys.users });
      await qc.invalidateQueries({ queryKey: wsKeys.roles });
      // Mail went out: done. Otherwise the link is shown once so it can be handed over.
      if (res.emailSent || !res.inviteLink) onCreated(res.member.fullName, res.emailSent);
      else setSent(res);
    },
    onError: (err) => {
      const info = wsError(err);
      const field =
        info.field === 'fullName' || info.field === 'email'
          ? info.field
          : info.field === 'roleIds' || (info.field as string) === 'roleId'
            ? 'roleId'
            : null;
      if (field) setFieldErrors({ [field]: info.detail ?? te(info.key, info.values) });
      else setServerError(info);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const parsed = inviteWspMemberSchema.safeParse({
      fullName: fullName.trim(),
      email: email.trim(),
      roleId,
    });
    const errs: Partial<Record<FieldName, ReactNode>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (p === 'fullName') errs.fullName ??= tc('required');
        else if (p === 'email') errs.email ??= t('emailInvalid');
      }
    }
    if (!roleId) errs.roleId = tc('required');
    setFieldErrors(errs);
    setServerError(null);
    const first = (['fullName', 'email', 'roleId'] as const).find((f) => errs[f] !== undefined);
    if (first) {
      document.getElementById(`member-${first}`)?.focus();
      return;
    }
    create.mutate();
  }

  const selected = roles.find((r) => r.id === roleId);
  const slug = selected ? presetSlug(selected.systemKey) : null;
  const clear = (f: FieldName) => () => setFieldErrors((x) => ({ ...x, [f]: undefined }));

  return (
    <Modal
      open
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      title={t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={tc('close')}
      size="md"
    >
      {sent ? (
        <div className="space-y-3" data-testid="invite-link-view">
          <Alert tone="warning">{t('linkNotSent', { email: email.trim() })}</Alert>
          <Input readOnly value={sent.inviteLink ?? ''} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(sent.inviteLink ?? '');
                setCopied(true);
              }}
            >
              {copied ? t('copied') : t('copyLink')}
            </Button>
            <Button onClick={() => onCreated(sent.member.fullName, false)}>{t('done')}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3" data-testid="add-member-form">
          <Field label={t('fullName')} htmlFor="member-fullName" error={fieldErrors.fullName}>
            <Input
              id="member-fullName"
              value={fullName}
              maxLength={255}
              autoComplete="off"
              required
              invalid={Boolean(fieldErrors.fullName)}
              onChange={(e) => {
                setFullName(e.target.value);
                clear('fullName')();
              }}
            />
          </Field>
          <Field label={t('email')} htmlFor="member-email" error={fieldErrors.email}>
            <Input
              id="member-email"
              type="email"
              value={email}
              maxLength={255}
              autoComplete="off"
              required
              invalid={Boolean(fieldErrors.email)}
              onChange={(e) => {
                setEmail(e.target.value);
                clear('email')();
              }}
            />
          </Field>
          <Field label={t('role')} htmlFor="member-roleId" error={fieldErrors.roleId}>
            <Select
              id="member-roleId"
              value={roleId}
              invalid={Boolean(fieldErrors.roleId)}
              onChange={(e) => {
                setRoleId(e.target.value);
                clear('roleId')();
              }}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          {slug && (
            <p className="text-xs text-muted-foreground" data-testid="role-blurb">
              {tr(slug)}
            </p>
          )}
          <p className="text-xs text-muted-foreground" data-testid="invite-hint">
            {t('inviteHint')}
          </p>
          {serverError && (
            <Alert tone="danger" className="space-y-1" data-testid="add-member-error">
              <p>{te(serverError.key, serverError.values)}</p>
            </Alert>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="submit-add-member">
              {create.isPending && <Spinner label={tc('loading')} />}
              {t('submitInvite')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
