'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformBrandingFooterResponseSchema } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  FOOTER_MAX,
  buildFooterPatch,
  clampFooter,
  footerLength,
  footerPreview,
} from '../lib/platform-footer';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { useUnsavedGuard } from '../ui/use-unsaved-guard';
import { BRANDING_FOOTER_KEY as KEY } from './query-keys';

const NS = 'auth-registration-security.platform.registration.footer';

/**
 * The line added to outgoing text messages of every workspace whose plan cannot remove branding
 * (TW-AUTH-029). It saves on its own: the policy form above it is a different document.
 */
export function PlatformFooterCard() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/branding-footer', {
        schema: platformBrandingFooterResponseSchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending)
    return (
      <Card>
        <LoadingBlock />
      </Card>
    );
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <FooterForm key={q.data.footer} saved={q.data} />;
}

function FooterForm({ saved }: { saved: { footer: string; isDefault: boolean } }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('registration');
  const id = useId();
  const [value, setValue] = useState(saved.footer);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  const patch = buildFooterPatch(saved, value);
  useUnsavedGuard(patch !== null);

  const save = useMutation({
    mutationFn: (body: { footer: string }) =>
      operatorFetch('/settings/branding-footer', {
        method: 'PATCH',
        body,
        schema: platformBrandingFooterResponseSchema,
      }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      setError(null);
      toast.success(t(data.footer ? 'saved' : 'savedNone'));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return;
      setError({
        message:
          err instanceof ApiError && err.status === 422
            ? (err.fieldErrors[0]?.message ?? t('errors.invalid'))
            : t('errors.unexpected'),
        requestId: err instanceof ApiError ? err.requestId : undefined,
      });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || !patch || save.isPending) return;
    setError(null);
    save.mutate(patch);
  }

  const used = footerLength(value);
  return (
    <Card className="space-y-4">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('kicker')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
          {saved.isDefault && <Badge tone="neutral">{t('builtIn')}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label={t('label')} htmlFor={id} hint={t('hint', { max: FOOTER_MAX })}>
          <Textarea
            id={id}
            rows={2}
            value={value}
            onChange={(e) => {
              setValue(clampFooter(e.target.value));
              if (error) setError(null);
            }}
            readOnly={!canEdit}
            spellCheck
            aria-describedby={`${id}-count`}
            className="resize-none"
          />
          <p
            id={`${id}-count`}
            className="text-end font-mono text-xs text-muted-foreground"
            aria-live="polite"
          >
            {t('count', { used, max: FOOTER_MAX })}
          </p>
        </Field>

        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('preview')}
          </p>
          <p className="whitespace-pre-wrap break-words italic text-muted-foreground">
            {footerPreview(value, t('noFooter'))}
          </p>
        </div>

        {error && (
          <Alert tone="danger" className="space-y-1">
            <p>{error.message}</p>
          </Alert>
        )}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={patch === null || save.isPending}>
              {save.isPending && <Spinner label={t('saving')} />}
              {save.isPending ? t('saving') : t('save')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setValue('');
                setError(null);
              }}
              disabled={value === '' || save.isPending}
            >
              {t('clear')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
