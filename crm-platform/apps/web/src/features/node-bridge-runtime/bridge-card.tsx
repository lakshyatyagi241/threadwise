'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  nodeBridgeResponseSchema,
  nodeBridgeTestResultSchema,
  type NodeBridgeResponse,
  type NodeBridgeTestResult,
} from '@crm/contracts';
import { Badge, Button, Card, Field, Input, PasswordInput } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

const NS = 'node-bridge-runtime';
const isHttpUrl = (v: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v);

/** The global address and shared token, saved on their own so they never touch a channel's credentials (TW-NODE-052). */
export function BridgeCard({ data, canEdit }: { data: NodeBridgeResponse; canEdit: boolean }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [serverUrl, setServerUrl] = useState(data.serverUrl);
  const [token, setToken] = useState('');
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [result, setResult] = useState<NodeBridgeTestResult | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: NODE_BRIDGE_QUERY_KEY });
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    toast.error(t(`errors.${kind}`));
    if (kind === 'conflict') void refresh();
  };

  const save = useMutation({
    mutationFn: () =>
      operatorFetch('/node-bridge', {
        method: 'PATCH',
        body: { serverUrl: serverUrl.trim(), token: token.trim(), rowVersion: data.rowVersion },
        schema: nodeBridgeResponseSchema,
      }),
    onSuccess: () => {
      toast.success(t('bridge.saved'));
      setToken('');
      return refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: () =>
      operatorFetch('/node-bridge/test', {
        method: 'POST',
        body: { serverUrl: serverUrl.trim(), token: token.trim() },
        schema: nodeBridgeTestResultSchema,
      }),
    onSuccess: setResult,
    onError: fail,
  });

  const urlOk = (url: string) => url === '' || isHttpUrl(url);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = !urlOk(serverUrl.trim());
    setUrlInvalid(bad);
    if (!bad) save.mutate();
  };
  const runTest = () => {
    setResult(null);
    const bad = !isHttpUrl(serverUrl.trim());
    setUrlInvalid(bad);
    if (!bad) test.mutate();
  };
  const busy = save.isPending || test.isPending;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('page.eyebrow')}
          </p>
          <h2 className="text-lg font-semibold">{t('page.title')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('page.description')}</p>
        </div>
        <Badge tone={data.tokenSet ? 'success' : 'neutral'}>
          {data.tokenSet ? t('bridge.tokenSet') : t('bridge.noToken')}
        </Badge>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label={t('bridge.serverUrl')}
          htmlFor={`${id}-url`}
          hint={t('bridge.serverUrlHint')}
          error={urlInvalid ? t('errors.validation') : undefined}
        >
          <Input
            id={`${id}-url`}
            type="url"
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            maxLength={191}
            value={serverUrl}
            placeholder={t('bridge.serverUrlPlaceholder')}
            invalid={urlInvalid}
            disabled={!canEdit}
            onChange={(e) => {
              setUrlInvalid(false);
              setServerUrl(e.target.value);
            }}
          />
        </Field>
        <Field label={t('bridge.token')} htmlFor={`${id}-token`} hint={t('bridge.tokenHint')}>
          <PasswordInput
            id={`${id}-token`}
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            maxLength={191}
            value={token}
            placeholder={
              data.tokenSet ? t('bridge.tokenSavedPlaceholder') : t('bridge.tokenPlaceholder')
            }
            disabled={!canEdit}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {save.isPending ? t('bridge.saving') : t('bridge.save')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={runTest}>
              {test.isPending ? t('bridge.testing') : t('bridge.test')}
            </Button>
            <span
              aria-live="polite"
              className={`text-sm ${result ? (result.ok ? 'text-success' : 'text-danger') : ''}`}
            >
              {result?.message}
            </span>
          </div>
        )}
      </form>
    </Card>
  );
}
