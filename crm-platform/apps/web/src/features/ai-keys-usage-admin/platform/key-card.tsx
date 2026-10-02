'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformAiKeyItemSchema, type PlatformAiKeyItem } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, Field, Input, PasswordInput, Select } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  draftFromItem,
  isDirty,
  toUpdateBody,
  type CardDraft,
  type DraftError,
} from '../lib/card-draft';
import { errorKind } from '../lib/errors';
import { KEYS_QUERY_KEY } from './queries';

const NS = 'ai-keys-usage-admin.keys';

/**
 * One provider: its state, the on/off switch and the form. The page remounts the card whenever the row changes (its key
 * includes the row version), so after any save, switch or conflict the form starts from what the server now holds.
 */
export function KeyCard({ item }: { item: PlatformAiKeyItem }) {
  const t = useTranslations(NS);
  const tc = useTranslations('ai-keys-usage-admin.common');
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<CardDraft>(() => draftFromItem(item));
  const [invalid, setInvalid] = useState<DraftError | null>(null);
  const [removing, setRemoving] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    toast.error(tc(`errors.${kind}`));
    if (kind === 'conflict') void refresh();
  };

  const save = useMutation({
    mutationFn: (body: unknown) =>
      operatorFetch(`/ai-keys/${item.id}`, {
        method: 'PATCH',
        body,
        schema: platformAiKeyItemSchema,
      }),
    onSuccess: (saved) => {
      toast.success(
        t(saved.isActive && !item.isActive ? 'toasts.savedOn' : 'toasts.saved', {
          name: item.name,
        }),
      );
      return refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (isActive: boolean) =>
      operatorFetch(`/ai-keys/${item.id}/active`, {
        method: 'PATCH',
        body: { isActive },
        schema: platformAiKeyItemSchema,
      }),
    onSuccess: (saved) => {
      toast.success(t(saved.isActive ? 'toasts.on' : 'toasts.off', { name: item.name }));
      return refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () =>
      operatorFetch(`/ai-keys/${item.id}`, {
        method: 'PATCH',
        body: { rowVersion: item.rowVersion, removeKey: true },
        schema: platformAiKeyItemSchema,
      }),
    onSuccess: () => {
      toast.success(t('toasts.removed', { name: item.name }));
      setRemoving(false);
      return refresh();
    },
    onError: (err) => {
      setRemoving(false);
      fail(err);
    },
  });

  const set = (patch: Partial<CardDraft>) => {
    setInvalid(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = toUpdateBody(item, draft);
    if ('error' in result) return setInvalid(result.error);
    save.mutate(result.body);
  };

  const choices = item.modelChoices;
  const custom = draft.defaultModel !== '' && !choices.includes(draft.defaultModel);
  const busy = save.isPending || toggle.isPending || remove.isPending;
  const err = (field: DraftError) => (invalid === field ? tc('errors.validation') : undefined);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{item.name}</h3>
            <Badge tone={item.isActive ? 'success' : 'neutral'}>
              {item.isActive ? t('card.active') : t('card.off')}
            </Badge>
            {item.hasKey ? (
              <Badge tone="success">
                {item.keyLast4
                  ? t('card.keySavedLast4', { last4: item.keyLast4 })
                  : t('card.keySaved')}
              </Badge>
            ) : (
              <Badge tone="warning">
                {item.keyUnreadable ? t('card.unreadable') : t('card.noKey')}
              </Badge>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground" dir="ltr">
            {t('card.slug')}: {item.provider}
          </p>
        </div>
        <Button
          variant={item.isActive ? 'secondary' : 'primary'}
          size="sm"
          disabled={busy}
          onClick={() => toggle.mutate(!item.isActive)}
        >
          {item.isActive ? t('card.turnOff') : t('card.turnOn')}
        </Button>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('card.apiKey')} htmlFor={`${id}-key`} hint={t('card.apiKeyHint')}>
            <PasswordInput
              id={`${id}-key`}
              autoComplete="off"
              value={draft.apiKey}
              maxLength={1024}
              placeholder={
                item.hasKey ? t('card.apiKeySavedPlaceholder') : t('card.apiKeyPlaceholder')
              }
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </Field>
          <Field label={t('card.defaultModel')} htmlFor={`${id}-model`} error={err('defaultModel')}>
            <Select
              id={`${id}-model`}
              value={draft.defaultModel}
              onChange={(e) => set({ defaultModel: e.target.value })}
            >
              <option value="">{t('card.pickModel')}</option>
              {custom && (
                <option value={draft.defaultModel}>
                  {t('card.customModel', { model: draft.defaultModel })}
                </option>
              )}
              {choices.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          {item.supportsMaxTokens && (
            <Field
              label={t('card.maxTokens')}
              htmlFor={`${id}-max`}
              hint={t('card.maxTokensHint')}
              error={err('maxTokens')}
            >
              <Input
                id={`${id}-max`}
                inputMode="numeric"
                placeholder="4096"
                value={draft.maxTokens}
                invalid={invalid === 'maxTokens'}
                onChange={(e) => set({ maxTokens: e.target.value })}
              />
            </Field>
          )}
          <Field label={t('card.sortOrder')} htmlFor={`${id}-order`} error={err('sortOrder')}>
            <Input
              id={`${id}-order`}
              type="number"
              min={0}
              max={32767}
              value={draft.sortOrder}
              invalid={invalid === 'sortOrder'}
              onChange={(e) => set({ sortOrder: e.target.value })}
            />
          </Field>
          <Field
            label={t('card.extraModels')}
            htmlFor={`${id}-extra`}
            hint={t('card.extraModelsHint')}
            error={err('extraModels')}
            className="md:col-span-2"
          >
            <Input
              id={`${id}-extra`}
              dir="ltr"
              value={draft.extraModels}
              invalid={invalid === 'extraModels'}
              onChange={(e) => set({ extraModels: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="submit" disabled={busy || !isDirty(item, draft)}>
            {save.isPending ? t('card.saving') : t('card.save', { name: item.name })}
          </Button>
          {item.hasKey && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(true)}>
              {t('card.removeKey')}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={removing}
        tone="danger"
        title={t('card.removeTitle', { name: item.name })}
        message={t('card.removeBody', { name: item.name })}
        confirmLabel={t('card.removeConfirm')}
        cancelLabel={t('card.cancel')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setRemoving(false)}
      />
    </Card>
  );
}
