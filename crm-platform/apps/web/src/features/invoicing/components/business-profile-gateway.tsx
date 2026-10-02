'use client';

import type { InvoiceGatewayResponse, UpdateInvoiceGatewayInput } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Field,
  PasswordInput,
  Select,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { KEYS, useInvoiceGateway } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { MAX_SECRET_LENGTH, generateSecret, secretProblem } from '../lib/profile-form';
import { Section } from './business-profile-ui';
import { CheckIcon, CopyIcon, RefreshIcon } from './icons';
import { ErrorLine } from './parts';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Online payments: the webhook connection of the payment provider. A separate save from the profile (its own endpoint). */
export function GatewaySection({
  canEdit,
  canView,
  onDirty,
}: {
  canEdit: boolean;
  canView: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const t = useTranslations('invoicing.settings.online');
  const query = useInvoiceGateway(canView);

  return (
    <Section id="online" title={t('title')} description={t('description')}>
      {!canView ? (
        <Alert tone="info">{t('noPermission')}</Alert>
      ) : query.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : query.isError ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <GatewayEditor
          key={`${query.data.updatedAt ?? 'new'}-${query.data.hasSecret}`}
          data={query.data}
          canEdit={canEdit}
          onDirty={onDirty}
        />
      )}
    </Section>
  );
}

function GatewayEditor({
  data,
  canEdit,
  onDirty,
}: {
  data: InvoiceGatewayResponse;
  canEdit: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const t = useTranslations('invoicing.settings.online');
  const uid = useId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(data.enabled);
  const [mode, setMode] = useState(data.mode);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<'path' | 'secret' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const dirty = enabled !== data.enabled || mode !== data.mode || secret !== '';
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const problem = secret ? secretProblem(secret) : null;
  const needsSecret = enabled && !data.hasSecret && !secret;
  const readOnly = !canEdit;

  async function flash(kind: 'path' | 'secret', text: string) {
    if (await copy(text)) {
      setCopied(kind);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    }
  }

  async function save() {
    if (busy || !dirty) return;
    setError(null);
    if (problem || needsSecret) return;
    const input: UpdateInvoiceGatewayInput = {};
    if (enabled !== data.enabled) input.enabled = enabled;
    if (mode !== data.mode) input.mode = mode;
    if (secret) input.webhookSecret = secret;
    setBusy(true);
    try {
      const next = await invoicingApi.updateGateway(input);
      qc.setQueryData(KEYS.gateway, next);
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={data.enabled ? 'success' : 'neutral'}>
          {data.enabled ? t('statusOn') : t('statusOff')}
        </Badge>
        {data.configured && (
          <Badge tone={data.mode === 'live' ? 'warning' : 'neutral'}>
            {data.mode === 'live' ? t('modeLive') : t('modeTest')}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {data.enabled ? t('whenOn') : t('whenOff')}
        </span>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('enabled')}</p>
          <p className="text-xs text-muted-foreground">{t('enabledHint')}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={readOnly || busy}
          label={t('enabled')}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('mode')} htmlFor={`${uid}-mode`} hint={t('modeHint')}>
          <Select
            id={`${uid}-mode`}
            value={mode}
            disabled={readOnly || busy}
            onChange={(e) => setMode(e.target.value === 'live' ? 'live' : 'test')}
          >
            <option value="test">{t('modeTest')}</option>
            <option value="live">{t('modeLive')}</option>
          </Select>
        </Field>
        <Field label={t('provider')} htmlFor={`${uid}-prov`} hint={t('providerHint')}>
          <div
            id={`${uid}-prov`}
            className="flex h-10 items-center rounded-md border border-border bg-muted px-3 text-sm"
          >
            {t('providerHmac')}
          </div>
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('webhook')}</p>
        {data.webhookPath ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                dir="ltr"
                className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">{t('apiOrigin')}</span>
                {data.webhookPath}
              </code>
              <Button
                type="button"
                variant="secondary"
                className="h-10 shrink-0"
                onClick={() => void flash('path', data.webhookPath ?? '')}
              >
                {copied === 'path' ? <CheckIcon /> : <CopyIcon />}{' '}
                {copied === 'path' ? t('copied') : t('copy')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('webhookHint')}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('webhookNone')}</p>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-2">
          <Field
            label={data.hasSecret ? t('secretRotate') : t('secret')}
            htmlFor={`${uid}-secret`}
            hint={data.hasSecret ? t('secretStored') : t('secretNone')}
            error={
              problem
                ? t(problem === 'short' ? 'secretShort' : 'secretLong', {
                    min: 16,
                    max: MAX_SECRET_LENGTH,
                  })
                : undefined
            }
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <PasswordInput
                  id={`${uid}-secret`}
                  value={secret}
                  maxLength={MAX_SECRET_LENGTH + 20}
                  autoComplete="new-password"
                  spellCheck={false}
                  dir="ltr"
                  invalid={!!problem}
                  disabled={busy}
                  showLabel={t('show')}
                  hideLabel={t('hide')}
                  placeholder={data.hasSecret ? '••••••••••••••••' : undefined}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-10 shrink-0"
                disabled={busy}
                onClick={() => setSecret(generateSecret())}
              >
                <RefreshIcon /> {t('generate')}
              </Button>
              {secret && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 shrink-0"
                  onClick={() => void flash('secret', secret)}
                >
                  {copied === 'secret' ? <CheckIcon /> : <CopyIcon />}{' '}
                  {copied === 'secret' ? t('copied') : t('copy')}
                </Button>
              )}
            </div>
          </Field>
          {secret && <p className="text-xs text-warning">{t('secretOnce')}</p>}
        </div>
      )}

      {needsSecret && !readOnly && <Alert tone="warning">{t('needsSecret')}</Alert>}
      {mode === 'live' && enabled && <Alert tone="warning">{t('liveWarning')}</Alert>}
      {!enabled && !data.configured && <Alert tone="info">{t('bankFallback')}</Alert>}
      {error !== null && <ErrorLine error={error} />}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            className="h-10 min-w-32"
            disabled={!dirty || busy || !!problem || needsSecret}
            onClick={() => void save()}
          >
            {busy && <Spinner />} {busy ? t('saving') : t('save')}
          </Button>
          {dirty && !busy && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEnabled(data.enabled);
                setMode(data.mode);
                setSecret('');
                setError(null);
              }}
            >
              {t('discard')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
