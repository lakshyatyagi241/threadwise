'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_PROVIDERS,
  findAiProvider,
  workspaceAiKeyItemSchema,
  workspaceAiKeysResponseSchema,
  type AiProviderSlug,
  type WorkspaceAiKeyItem,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  PasswordInput,
  Select,
  Switch,
  useToast,
} from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { errorKind } from '../lib/errors';
import { ErrorBlock, LoadingBlock } from '../shared/state';
import { AI_KEYS } from './api';

const NS = 'ai-keys-usage-admin.own';
const MIN_KEY = 8;
const nameOf = (slug: string) => findAiProvider(slug)?.name ?? slug;

/** The workspace's own provider keys: add or replace one, switch it on or off, remove it, see which key calls use. */
export function WorkspaceKeysPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('ai-keys-usage-admin.common');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [provider, setProvider] = useState<AiProviderSlug>('openai');
  const [apiKey, setApiKey] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceAiKeyItem | null>(null);

  const q = useQuery({
    queryKey: AI_KEYS.keys,
    queryFn: ({ signal }) =>
      apiFetch('/ai/provider-keys', { schema: workspaceAiKeysResponseSchema, signal }),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: AI_KEYS.keys }),
      qc.invalidateQueries({ queryKey: AI_KEYS.models }),
    ]);
  const fail = (err: unknown) => toast(tc(`errors.${errorKind(err)}`), 'danger');

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/ai/provider-keys/${provider}`, {
        method: 'PUT',
        body: { apiKey: apiKey.trim() },
        schema: workspaceAiKeyItemSchema,
      }),
    onSuccess: (saved) => {
      toast(t('toasts.saved', { name: nameOf(saved.provider) }));
      setApiKey('');
      return refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (v: { key: WorkspaceAiKeyItem; isActive: boolean }) =>
      apiFetch(`/ai/provider-keys/${v.key.id}/active`, {
        method: 'PATCH',
        body: { isActive: v.isActive },
        schema: workspaceAiKeyItemSchema,
      }),
    onSuccess: (saved) => {
      toast(t(saved.isActive ? 'toasts.on' : 'toasts.off', { name: nameOf(saved.provider) }));
      return refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (key: WorkspaceAiKeyItem) =>
      apiFetch(`/ai/provider-keys/${key.id}`, { method: 'DELETE' }),
    onSuccess: (_void, key) => {
      toast(t('toasts.removed', { name: nameOf(key.provider) }));
      setRemoving(null);
      return refresh();
    },
    onError: (err) => {
      setRemoving(null);
      fail(err);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (apiKey.trim().length < MIN_KEY) return setTooShort(true);
    save.mutate();
  };

  const sourceOf = (slug: string) =>
    q.data?.sources.find((s) => s.provider === slug)?.source ?? 'none';
  const existing = q.data?.data.find((k) => k.provider === provider);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Alert tone={q.data.byokAllowed ? 'success' : 'warning'}>
            {q.data.byokAllowed ? t('allowed') : t('notAllowed')}
          </Alert>

          <Card>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <h2 className="font-semibold">{t('add')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('provider')} htmlFor="own-provider">
                  <Select
                    id="own-provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as AiProviderSlug)}
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('apiKey')}
                  htmlFor="own-key"
                  hint={t('apiKeyHint')}
                  error={tooShort ? t('errors.tooShort') : undefined}
                >
                  <PasswordInput
                    id="own-key"
                    autoComplete="off"
                    value={apiKey}
                    maxLength={1024}
                    invalid={tooShort}
                    onChange={(e) => {
                      setTooShort(false);
                      setApiKey(e.target.value);
                    }}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={save.isPending || apiKey.trim() === ''}>
                {save.isPending ? t('saving') : existing ? t('replace') : t('save')}
              </Button>
            </form>
          </Card>

          {q.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-3">
              {q.data.data.map((key) => {
                const source = sourceOf(key.provider);
                return (
                  <li key={key.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{nameOf(key.provider)}</span>
                          <Badge tone={key.isActive ? 'success' : 'neutral'}>
                            {key.isActive ? t('on') : t('off')}
                          </Badge>
                          {key.keyLast4 && (
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                              {t('ends', { last4: key.keyLast4 })}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('using')}:{' '}
                          {source === 'workspace'
                            ? t('usingOwn')
                            : source === 'admin'
                              ? t('usingShared')
                              : t('usingNone')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={key.isActive}
                          label={key.isActive ? t('turnOff') : t('turnOn')}
                          disabled={toggle.isPending}
                          onCheckedChange={(isActive) => toggle.mutate({ key, isActive })}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(key)}>
                          {t('remove')}
                        </Button>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={t('removeTitle', { name: removing ? nameOf(removing.provider) : '' })}
        message={t('removeBody')}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('cancel')}
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
