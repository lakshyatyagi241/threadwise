'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { webhookTargetItemSchema, type WebhookTargetItem } from '@crm/contracts';
import { Button, Checkbox, Field, Input, Modal, PasswordInput, Switch } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  EMPTY_DRAFT,
  draftFromTarget,
  fieldForPath,
  toCreateBody,
  toUpdateBody,
  type DraftField,
  type TargetDraft,
} from './lib/draft';
import { errorKind } from './lib/errors';
import { TARGETS_QUERY_KEY } from './queries';
import { TagInput } from './tag-input';

const NS = 'webhook-fanout.dialog';

/**
 * Add or edit one target. The page mounts it only while open (with a key per target and row version), so every
 * opening starts from what the server holds. A conflict closes it and reloads the list: never a silent retry.
 */
export function TargetDialog({
  target,
  onClose,
}: {
  /** null = add a new target. */
  target: WebhookTargetItem | null;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('webhook-fanout.common');
  const tt = useTranslations('webhook-fanout.targets.toasts');
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<TargetDraft>(() =>
    target ? draftFromTarget(target) : EMPTY_DRAFT,
  );
  const [problems, setProblems] = useState<Partial<Record<DraftField, string>>>({});

  const set = (patch: Partial<TargetDraft>) => {
    setProblems({});
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = useMutation({
    mutationFn: (req: { method: 'POST' | 'PATCH'; path: string; body: unknown }) =>
      operatorFetch(req.path, {
        method: req.method,
        body: req.body,
        schema: webhookTargetItemSchema,
      }),
    onSuccess: async (saved) => {
      toast.success(tt(target ? 'saved' : 'created', { name: saved.name }));
      await qc.invalidateQueries({ queryKey: TARGETS_QUERY_KEY });
      onClose();
    },
    onError: (err) => {
      const kind = errorKind(err);
      if (kind === 'conflict') {
        toast.error(tc('errors.conflict'));
        void qc.invalidateQueries({ queryKey: TARGETS_QUERY_KEY });
        onClose();
        return;
      }
      if (kind === 'urlRejected') return setProblems({ url: tc('errors.urlRejected') });
      if (kind === 'validation' && err instanceof ApiError && err.fieldErrors.length > 0) {
        const next: Partial<Record<DraftField, string>> = {};
        for (const fe of err.fieldErrors) {
          const field = fieldForPath(fe.path);
          if (field && !next[field]) next[field] = tc('errors.validation');
        }
        if (Object.keys(next).length > 0) return setProblems(next);
      }
      toast.error(tc(`errors.${kind}`));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = target ? toUpdateBody(target, draft) : toCreateBody(draft);
    if ('problems' in result) {
      const next: Partial<Record<DraftField, string>> = {};
      for (const [field, key] of Object.entries(result.problems)) {
        next[field as DraftField] = t(`errors.${key}`);
      }
      return setProblems(next);
    }
    save.mutate(
      target
        ? { method: 'PATCH', path: `/webhook-targets/${target.id}`, body: result.body }
        : { method: 'POST', path: '/webhook-targets', body: result.body },
    );
  };

  const busy = save.isPending;
  const hasSaved = target?.hasAuthHeader === true;
  const formId = `${id}-form`;

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      closeLabel={t('close')}
      title={target ? t('editTitle', { name: target.name }) : t('createTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <Field label={t('name')} htmlFor={`${id}-name`} error={problems.name}>
          <Input
            id={`${id}-name`}
            value={draft.name}
            maxLength={80}
            placeholder={t('namePlaceholder')}
            invalid={Boolean(problems.name)}
            autoFocus
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={t('url')} htmlFor={`${id}-url`} hint={t('urlHint')} error={problems.url}>
          <Input
            id={`${id}-url`}
            dir="ltr"
            type="url"
            inputMode="url"
            value={draft.url}
            maxLength={2000}
            placeholder="https://example.com/webhooks/meta"
            invalid={Boolean(problems.url)}
            onChange={(e) => set({ url: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('headerName')}
            htmlFor={`${id}-hname`}
            hint={t('headerNameHint')}
            error={problems.headerName}
          >
            <Input
              id={`${id}-hname`}
              dir="ltr"
              autoComplete="off"
              value={draft.headerName}
              maxLength={80}
              placeholder="Authorization"
              disabled={draft.removeHeader}
              invalid={Boolean(problems.headerName)}
              onChange={(e) => set({ headerName: e.target.value })}
            />
          </Field>
          <Field
            label={t('headerValue')}
            htmlFor={`${id}-hvalue`}
            hint={
              hasSaved
                ? target.authHeaderLast4
                  ? t('headerValueSaved', { last4: target.authHeaderLast4 })
                  : t('headerValueSavedNoLast4')
                : t('headerValueHint')
            }
            error={problems.headerValue}
          >
            <PasswordInput
              id={`${id}-hvalue`}
              autoComplete="off"
              value={draft.headerValue}
              maxLength={500}
              disabled={draft.removeHeader}
              invalid={Boolean(problems.headerValue)}
              onChange={(e) => set({ headerValue: e.target.value })}
            />
          </Field>
        </div>
        {hasSaved && (
          <Checkbox
            id={`${id}-remove`}
            label={t('removeHeader')}
            checked={draft.removeHeader}
            onChange={(e) => set({ removeHeader: e.target.checked, headerValue: '' })}
          />
        )}

        <Field label={t('fieldFilter')} htmlFor={`${id}-fields`} hint={t('fieldFilterHint')}>
          <TagInput
            id={`${id}-fields`}
            tags={draft.fieldFilter}
            onChange={(fieldFilter) => set({ fieldFilter })}
            placeholder={t('fieldFilterPlaceholder')}
            removeLabel={(field) => t('fieldRemove', { field })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('timeout')}
            htmlFor={`${id}-timeout`}
            hint={t('timeoutHint')}
            error={problems.timeoutSeconds}
          >
            <Input
              id={`${id}-timeout`}
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={draft.timeoutSeconds}
              invalid={Boolean(problems.timeoutSeconds)}
              onChange={(e) => set({ timeoutSeconds: e.target.value })}
            />
          </Field>
          <Field
            label={t('maxAttempts')}
            htmlFor={`${id}-attempts`}
            hint={t('maxAttemptsHint')}
            error={problems.maxAttempts}
          >
            <Input
              id={`${id}-attempts`}
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={draft.maxAttempts}
              invalid={Boolean(problems.maxAttempts)}
              onChange={(e) => set({ maxAttempts: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id={`${id}-active`}
            checked={draft.isActive}
            onCheckedChange={(isActive) => set({ isActive })}
            label={t('active')}
          />
          <label htmlFor={`${id}-active`} className="text-sm">
            {t('active')}
          </label>
        </div>
      </form>
    </Modal>
  );
}
