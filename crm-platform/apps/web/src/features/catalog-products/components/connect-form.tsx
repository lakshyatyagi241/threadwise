'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, PasswordInput, Select, Spinner, cn, useToast } from '@crm/ui';
import { CATALOG_PROVIDERS, type CatalogProvider } from '@crm/contracts';
import { connectCatalog, KEYS } from '../api/catalog';
import { fieldErrors } from '../lib/errors';
import {
  EMPTY_CONNECT_FORM,
  buildConnect,
  connectProblems,
  type ConnectField,
  type ConnectForm as Form,
} from '../lib/setup-forms';
import { ErrorLine } from './parts';
import { useErrorText } from './use-error-text';

/**
 * The manual connect form (TW-CAT-002): provider, catalog id and name, WABA and phone number ids, and the access token. The
 * server verifies the binding against Meta and refuses with Meta's own message; it is shown under the token field and what
 * was typed stays.
 */
export function ConnectForm({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('catalogProducts.connect');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(EMPTY_CONNECT_FORM);
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const problems = connectProblems(form);
  const serverFields = fieldErrors(error);
  const fieldError = (k: ConnectField): string | undefined => {
    if (picked && problems[k]) return t(`problem.${problems[k]}`);
    return serverFields[k];
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPicked(true);
    setError(null);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      await connectCatalog(buildConnect(form));
      toast(t('connected'), 'success');
      setForm(EMPTY_CONNECT_FORM);
      setPicked(false);
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const tokenError = fieldError('accessToken') ?? (error ? errorText(error) : undefined);

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', compact ? 'mt-4' : 'mt-5')}
    >
      <Field label={t('provider')} htmlFor="cat-provider">
        <Select
          id="cat-provider"
          value={form.provider}
          onChange={(e) => patch({ provider: e.target.value as CatalogProvider })}
        >
          {CATALOG_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(`providers.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={
          <>
            {t('catalogId')} <span className="text-danger">*</span>
          </>
        }
        htmlFor="cat-catalog-id"
        error={fieldError('catalogId')}
      >
        <Input
          id="cat-catalog-id"
          value={form.catalogId}
          maxLength={64}
          placeholder="194836011239..."
          invalid={Boolean(fieldError('catalogId'))}
          className="font-mono"
          onChange={(e) => patch({ catalogId: e.target.value })}
        />
      </Field>
      <Field
        label={
          <>
            {t('catalogName')}{' '}
            <span className="font-normal text-muted-foreground">{t('label')}</span>
          </>
        }
        htmlFor="cat-catalog-name"
        error={fieldError('catalogName')}
      >
        <Input
          id="cat-catalog-name"
          value={form.catalogName}
          maxLength={191}
          placeholder={t('catalogNamePlaceholder')}
          onChange={(e) => patch({ catalogName: e.target.value })}
        />
      </Field>
      <Field label={t('wabaId')} htmlFor="cat-waba-id" error={fieldError('wabaId')}>
        <Input
          id="cat-waba-id"
          value={form.wabaId}
          maxLength={64}
          placeholder="123456789012345"
          className="font-mono"
          onChange={(e) => patch({ wabaId: e.target.value })}
        />
      </Field>
      <Field label={t('phoneNumberId')} htmlFor="cat-phone-id" error={fieldError('phoneNumberId')}>
        <Input
          id="cat-phone-id"
          value={form.phoneNumberId}
          maxLength={64}
          placeholder="106540352242922"
          className="font-mono"
          onChange={(e) => patch({ phoneNumberId: e.target.value })}
        />
      </Field>
      <Field
        label={
          <>
            {t('accessToken')} <span className="text-danger">*</span>
          </>
        }
        htmlFor="cat-token"
        hint={t('accessTokenHint')}
        error={tokenError}
      >
        <PasswordInput
          id="cat-token"
          value={form.accessToken}
          maxLength={4096}
          autoComplete="off"
          showLabel={t('showToken')}
          hideLabel={t('hideToken')}
          placeholder={t('accessTokenPlaceholder')}
          invalid={Boolean(tokenError)}
          className="font-mono"
          onChange={(e) => patch({ accessToken: e.target.value })}
        />
      </Field>
      {error && !serverFields.accessToken ? (
        <ErrorLine className="sm:col-span-2">{errorText(error)}</ErrorLine>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3 sm:col-span-2">
        <Button type="submit" variant="brand" className="rounded-full px-5" disabled={busy}>
          {busy && <Spinner />}
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
