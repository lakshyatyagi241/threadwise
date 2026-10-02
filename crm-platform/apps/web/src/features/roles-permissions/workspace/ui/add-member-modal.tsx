'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUserSchema, type RoleResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, PasswordInput, Select, Spinner } from '@crm/ui';
import { createUser, wsKeys } from '../lib/api';
import { wsError, type WsError } from '../lib/errors';
import { generatePassword, presetSlug } from '../lib/members';

const NS = 'roles-permissions-workspace.team.add';
type FieldName = 'fullName' | 'email' | 'password' | 'roleId';

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
  onCreated: (name: string) => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const tc = useTranslations('roles-permissions-workspace.common');
  const tr = useTranslations('roles-permissions-workspace.blurb');
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(() => defaultRoleId(roles));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, ReactNode>>>({});
  const [serverError, setServerError] = useState<WsError | null>(null);
  const [generated, setGenerated] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      createUser({ fullName: fullName.trim(), email: email.trim(), password, roleIds: [roleId] }),
    onSuccess: async (user) => {
      await qc.invalidateQueries({ queryKey: wsKeys.users });
      await qc.invalidateQueries({ queryKey: wsKeys.roles });
      onCreated(user.fullName);
    },
    onError: (err) => {
      const info = wsError(err);
      const field =
        info.field === 'fullName' || info.field === 'email' || info.field === 'password'
          ? info.field
          : info.field === 'roleIds'
            ? 'roleId'
            : null;
      if (field === 'password' && info.policy) {
        setFieldErrors({
          password: (
            <span data-testid="password-policy">
              {te('passwordPolicy')}
              {info.policy.map((rule) => (
                <span key={rule} className="mt-0.5 block ps-2">
                  – {rule}
                </span>
              ))}
            </span>
          ),
        });
      } else if (field) setFieldErrors({ [field]: info.detail ?? te(info.key, info.values) });
      else setServerError(info);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const parsed = createUserSchema.safeParse({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      roleIds: roleId ? [roleId] : [],
    });
    const errs: Partial<Record<FieldName, ReactNode>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (p === 'fullName') errs.fullName ??= tc('required');
        else if (p === 'email') errs.email ??= t('emailInvalid');
        else if (p === 'password') errs.password ??= t('passwordShort');
      }
    }
    if (!roleId) errs.roleId = tc('required');
    setFieldErrors(errs);
    setServerError(null);
    const first = (['fullName', 'email', 'password', 'roleId'] as const).find((f) => errs[f]);
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
        <Field
          label={t('password')}
          htmlFor="member-password"
          hint={generated ? t('passwordGenerated') : t('passwordHint')}
          error={fieldErrors.password}
        >
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <PasswordInput
                id="member-password"
                value={password}
                maxLength={255}
                autoComplete="new-password"
                required
                invalid={Boolean(fieldErrors.password)}
                showLabel={tc('showPassword')}
                hideLabel={tc('hidePassword')}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setGenerated(false);
                  clear('password')();
                }}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setPassword(generatePassword());
                setGenerated(true);
                clear('password')();
              }}
              data-testid="generate-password"
            >
              {t('generate')}
            </Button>
          </div>
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
        {serverError && (
          <Alert tone="danger" className="space-y-1" data-testid="add-member-error">
            <p>{te(serverError.key, serverError.values)}</p>
            {serverError.requestId && (
              <p className="font-mono text-xs opacity-80">
                {tc('requestId')}: {serverError.requestId}
              </p>
            )}
          </Alert>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending} data-testid="submit-add-member">
            {create.isPending && <Spinner label={tc('loading')} />}
            {t('submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
