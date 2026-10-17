'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  MAIL_TLS_MODES,
  type MailConnectionTestResponse,
  type MailScope,
  type MailTlsMode,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  PasswordInput,
  Select,
  Spinner,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, connectImap, testImap } from '../api/mailboxes';
import { mailErrorKey } from '../lib/api-errors';
import {
  IMAP_PRESETS,
  applyPreset,
  buildImapInput,
  buildTestInput,
  emptyImapForm,
  imapFailureKey,
  withSecurity,
  type ImapErrors,
  type ImapField,
  type ImapForm,
} from '../lib/imap-form';
import { testErrorKey } from '../lib/test-view';
import { ConnectionTestResult } from './connection-test-result';

export interface ImapDialogTarget {
  /** Set when the form reconnects an existing mailbox (address fixed, password asked again). */
  mailboxId?: string;
  scope: MailScope;
  initial?: ImapForm;
}

/**
 * Connects an IMAP/SMTP mailbox (TW-MAIL-031). The server logs in to both servers before it stores anything, and the error says which
 * of the two refused. The password goes to the API once and is never shown again: the form unmounts on close, so nothing is kept.
 */
export function ImapConnectDialog({
  target,
  onClose,
  onConnected,
}: {
  target: ImapDialogTarget | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const t = useTranslations('email.imap');
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      size="lg"
      title={target?.mailboxId ? t('reconnectTitle') : t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
    >
      {target && (
        <ImapFormBody
          key={target.mailboxId ?? 'new'}
          target={target}
          onClose={onClose}
          onConnected={onConnected}
        />
      )}
    </Modal>
  );
}

function ImapFormBody({
  target,
  onClose,
  onConnected,
}: {
  target: ImapDialogTarget;
  onClose: () => void;
  onConnected: () => void;
}) {
  const t = useTranslations('email.imap');
  const root = useTranslations('email');
  const qc = useQueryClient();
  const uid = useId();
  const [form, setForm] = useState<ImapForm>(() => target.initial ?? emptyImapForm());
  const [errors, setErrors] = useState<ImapErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<MailConnectionTestResponse | null>(null);
  const reconnect = Boolean(target.mailboxId);

  const set = <K extends keyof ImapForm>(key: K, value: ImapForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // A result describes the settings it was run with: changing one makes it stale.
    setTested(null);
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const err = (field: ImapField): string | undefined => {
    const kind = errors[field];
    return kind ? t(`errors.${kind}`) : undefined;
  };
  const id = (name: string) => `${uid}-${name}`;

  const submit = async () => {
    const built = buildImapInput(form, target.scope, target.mailboxId);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(null);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await connectImap(built.input);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      onConnected();
    } catch (e) {
      if (e instanceof ApiError) {
        const which = imapFailureKey(e.code);
        const key = mailErrorKey(e.code);
        setFailure(
          which ? t(`failure.${which}`) : key ? root(`errors.${key}`) : t('failure.generic'),
        );
      } else {
        setFailure(t('failure.generic'));
      }
      // The password is cleared after any refusal: it is typed again, never kept in the form.
      setForm((f) => ({ ...f, imapPassword: '', smtpPassword: '' }));
    } finally {
      setBusy(false);
    }
  };

  /** "Test credentials": connects to both servers and signs in; nothing is saved and nothing is sent. */
  const runTest = async () => {
    const built = buildTestInput(form);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(null);
      setTested(null);
      return;
    }
    setTesting(true);
    setFailure(null);
    setTested(null);
    try {
      setTested(await testImap(built.input));
    } catch (e) {
      setFailure(t(`test.${e instanceof ApiError ? testErrorKey(e.code) : 'failed'}`));
    } finally {
      setTesting(false);
    }
  };

  const security = (value: MailTlsMode, onChange: (v: MailTlsMode) => void, name: string) => (
    <Select
      id={id(name)}
      value={value}
      onChange={(e) => onChange(e.target.value as MailTlsMode)}
      disabled={busy}
    >
      {MAIL_TLS_MODES.map((m) => (
        <option key={m} value={m}>
          {t(`security.${m}`)}
        </option>
      ))}
    </Select>
  );

  const group = (title: string, children: ReactNode) => (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-[13px] font-semibold">{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <form
      noValidate
      data-testid="email-imap-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        {reconnect ? t('reconnectIntro') : t('intro')}
      </p>

      {failure && (
        <Alert tone="danger" data-testid="email-imap-failure">
          {failure}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('address')} htmlFor={id('address')} error={err('address')}>
          <Input
            id={id('address')}
            type="email"
            dir="ltr"
            autoComplete="off"
            value={form.address}
            readOnly={reconnect}
            invalid={!!errors.address}
            placeholder="support@yourcompany.com"
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
        <Field label={t('displayName')} htmlFor={id('name')} error={err('displayName')}>
          <Input
            id={id('name')}
            maxLength={80}
            value={form.displayName}
            invalid={!!errors.displayName}
            onChange={(e) => set('displayName', e.target.value)}
          />
        </Field>
      </div>

      {!reconnect && (
        <Field label={t('preset')} htmlFor={id('preset')} hint={t('presetHint')}>
          <Select
            id={id('preset')}
            defaultValue=""
            disabled={busy}
            onChange={(e) =>
              setForm((f) =>
                applyPreset(f, IMAP_PRESETS.find((p) => p.id === e.target.value) ?? null),
              )
            }
          >
            <option value="">{t('presetCustom')}</option>
            {IMAP_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {group(
        t('incoming'),
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <Field label={t('host')} htmlFor={id('imap-host')} error={err('imapHost')}>
              <Input
                id={id('imap-host')}
                dir="ltr"
                autoComplete="off"
                value={form.imapHost}
                invalid={!!errors.imapHost}
                placeholder="imap.yourcompany.com"
                onChange={(e) => set('imapHost', e.target.value)}
              />
            </Field>
            <Field label={t('port')} htmlFor={id('imap-port')} error={err('imapPort')}>
              <Input
                id={id('imap-port')}
                dir="ltr"
                inputMode="numeric"
                value={form.imapPort}
                invalid={!!errors.imapPort}
                onChange={(e) => set('imapPort', e.target.value)}
              />
            </Field>
            <Field label={t('securityLabel')} htmlFor={id('imap-security')}>
              {security(
                form.imapSecurity,
                (v) => setForm((f) => withSecurity(f, 'imap', v)),
                'imap-security',
              )}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('username')} htmlFor={id('imap-user')} error={err('imapUsername')}>
              <Input
                id={id('imap-user')}
                dir="ltr"
                autoComplete="off"
                value={form.imapUsername}
                invalid={!!errors.imapUsername}
                onChange={(e) => set('imapUsername', e.target.value)}
              />
            </Field>
            <Field
              label={t('password')}
              htmlFor={id('imap-pass')}
              error={err('imapPassword')}
              hint={reconnect ? t('passwordAgain') : t('passwordHint')}
            >
              <PasswordInput
                id={id('imap-pass')}
                dir="ltr"
                autoComplete="new-password"
                value={form.imapPassword}
                invalid={!!errors.imapPassword}
                showLabel={t('showPassword')}
                hideLabel={t('hidePassword')}
                onChange={(e) => set('imapPassword', e.target.value)}
              />
            </Field>
          </div>
          {form.imapSecurity === 'none' && (
            <p role="status" className="text-xs text-warning">
              {t('noEncryption')}
            </p>
          )}
        </>,
      )}

      {group(
        t('outgoing'),
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <Field label={t('host')} htmlFor={id('smtp-host')} error={err('smtpHost')}>
              <Input
                id={id('smtp-host')}
                dir="ltr"
                autoComplete="off"
                value={form.smtpHost}
                invalid={!!errors.smtpHost}
                placeholder="smtp.yourcompany.com"
                onChange={(e) => set('smtpHost', e.target.value)}
              />
            </Field>
            <Field label={t('port')} htmlFor={id('smtp-port')} error={err('smtpPort')}>
              <Input
                id={id('smtp-port')}
                dir="ltr"
                inputMode="numeric"
                value={form.smtpPort}
                invalid={!!errors.smtpPort}
                onChange={(e) => set('smtpPort', e.target.value)}
              />
            </Field>
            <Field label={t('securityLabel')} htmlFor={id('smtp-security')}>
              {security(
                form.smtpSecurity,
                (v) => setForm((f) => withSecurity(f, 'smtp', v)),
                'smtp-security',
              )}
            </Field>
          </div>
          <Checkbox
            label={t('sameCredentials')}
            className="text-xs"
            checked={form.sameCredentials}
            onChange={(e) => set('sameCredentials', e.target.checked)}
            disabled={busy}
            data-testid="email-imap-same"
          />
          {!form.sameCredentials && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('username')} htmlFor={id('smtp-user')} error={err('smtpUsername')}>
                <Input
                  id={id('smtp-user')}
                  dir="ltr"
                  autoComplete="off"
                  value={form.smtpUsername}
                  invalid={!!errors.smtpUsername}
                  onChange={(e) => set('smtpUsername', e.target.value)}
                />
              </Field>
              <Field label={t('password')} htmlFor={id('smtp-pass')} error={err('smtpPassword')}>
                <PasswordInput
                  id={id('smtp-pass')}
                  dir="ltr"
                  autoComplete="new-password"
                  value={form.smtpPassword}
                  invalid={!!errors.smtpPassword}
                  showLabel={t('showPassword')}
                  hideLabel={t('hidePassword')}
                  onChange={(e) => set('smtpPassword', e.target.value)}
                />
              </Field>
            </div>
          )}
          {form.smtpSecurity === 'none' && (
            <p role="status" className="text-xs text-warning">
              {t('noEncryption')}
            </p>
          )}
        </>,
      )}

      <p className="text-xs text-muted-foreground">{t('verifyNote')}</p>

      {tested && <ConnectionTestResult result={tested} />}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="me-auto rounded-full"
          disabled={busy || testing}
          onClick={() => void runTest()}
          data-testid="email-imap-test"
        >
          {testing && <Spinner />} {testing ? t('test.testing') : t('test.button')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="rounded-full"
          disabled={busy}
          onClick={onClose}
        >
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          className="rounded-full"
          disabled={busy || testing}
          data-testid="email-imap-submit"
        >
          {busy && <Spinner />}{' '}
          {busy ? t('verifying') : reconnect ? t('reconnectSubmit') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
