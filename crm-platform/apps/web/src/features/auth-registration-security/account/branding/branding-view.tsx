'use client';

import { ERROR_CODES, updateBrandingRequestSchema, type BrandingResponse } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { useSession } from '../../shared/session-context';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { PLANS_PATH } from '../plans/plan-format';

export const FOOTER_MAX = 60;
const BRANDING_PERMISSION = 'auth.branding.update';

/** The line outgoing messages end with: the saved footer, else the platform default. */
export function effectiveFooter(
  data: Pick<BrandingResponse, 'messageFooter' | 'platformDefault'>,
): string {
  return data.messageFooter ?? data.platformDefault;
}

export function BrandingView() {
  const c = useTranslations('auth-registration-security.account.common');
  const { permissions } = useSession();
  const query = useQuery({ queryKey: keys.branding, queryFn: authApi.branding, staleTime: 0 });
  useGateRedirect(query.error);

  if (query.isPending) {
    return (
      <Card className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={c('loading')} /> {c('loading')}
      </Card>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-3">
        <ErrorNote error={query.error} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {c('retry')}
        </Button>
      </div>
    );
  }
  const hasPermission = BRANDING_PERMISSION in permissions;
  return <BrandingPane data={query.data} hasPermission={hasPermission} />;
}

/** Preview of an outgoing message with its footer. Pure presentation. */
function FooterPreview({ footer }: { footer: string }) {
  const t = useTranslations('auth-registration-security.account.branding');
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('preview')}
      </p>
      <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
        <p>{t('sampleMessage')}</p>
        <p
          className="mt-1 whitespace-pre-wrap break-words italic text-muted-foreground"
          data-testid="footer-preview"
        >
          {footer.trim() ? footer : t('noFooter')}
        </p>
      </div>
    </div>
  );
}

function BrandingPane({ data, hasPermission }: { data: BrandingResponse; hasPermission: boolean }) {
  const t = useTranslations('auth-registration-security.account.branding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();
  const [value, setValue] = useState(effectiveFooter(data));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<'save' | 'reset' | null>(null);
  const [saved, setSaved] = useState<'saved' | 'reset' | null>(null);

  const editable = data.canEdit && hasPermission;
  const usingDefault = data.messageFooter === null;
  const dirty = value.trim() !== effectiveFooter(data);

  const explain = !data.canEdit ? t('planLocked') : !hasPermission ? t('permissionLocked') : null;

  async function send(messageFooter: string | null, kind: 'save' | 'reset') {
    setPending(kind);
    setError(null);
    setSaved(null);
    try {
      const updated = await authApi.updateBranding({ messageFooter });
      queryClient.setQueryData(keys.branding, updated);
      setValue(effectiveFooter(updated));
      setSaved(kind === 'save' ? 'saved' : 'reset');
      // The org's footer is part of the session the shell reads.
      router.refresh();
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.PLAN_FEATURE_LOCKED) {
        // The plan changed under the page (or the form was open on a stale read): re-read, which
        // turns the page into its read-only, upgrade-hint state.
        setError(null);
        void queryClient.invalidateQueries({ queryKey: keys.branding });
      } else if (err instanceof ApiError && err.code === ERROR_CODES.FORBIDDEN) {
        setError(null);
        setFieldError(t('forbidden'));
        void queryClient.invalidateQueries({ queryKey: keys.branding });
      } else {
        setError(err);
      }
    } finally {
      setPending(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || !dirty) return;
    const parsed = updateBrandingRequestSchema.safeParse({ messageFooter: value });
    if (!parsed.success) {
      setFieldError(t('tooLong', { max: FOOTER_MAX }));
      document.getElementById(`${uid}-footer`)?.focus();
      return;
    }
    setFieldError(null);
    // Blank is a deliberate "no footer" ('', not null).
    void send(parsed.data.messageFooter, 'save');
  }

  if (!editable) {
    return (
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        {explain && (
          <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1">{explain}</span>
            {!data.canEdit && (
              <Link
                href={PLANS_PATH}
                className="shrink-0 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('upgrade')}
              </Link>
            )}
          </Alert>
        )}
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {usingDefault ? t('currentDefault') : t('current')}
          </p>
          <p
            className="rounded-md border border-border bg-muted px-3 py-2 text-sm italic"
            data-testid="current-footer"
          >
            {effectiveFooter(data).trim() ? effectiveFooter(data) : t('noFooter')}
          </p>
        </div>
        <FooterPreview footer={effectiveFooter(data)} />
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {usingDefault && (
        <Alert tone="info">{t('usingDefault', { footer: data.platformDefault })}</Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label={t('label', { max: FOOTER_MAX })}
          htmlFor={`${uid}-footer`}
          hint={t('hint')}
          error={fieldError}
        >
          <Input
            id={`${uid}-footer`}
            value={value}
            maxLength={FOOTER_MAX}
            onChange={(e) => {
              setValue(e.target.value);
              setFieldError(null);
              setSaved(null);
            }}
            invalid={Boolean(fieldError)}
            placeholder={data.platformDefault}
          />
          <p className="text-end text-xs text-muted-foreground" aria-live="off">
            {value.length}/{FOOTER_MAX}
          </p>
        </Field>

        <FooterPreview footer={value} />

        <ErrorNote error={error} />
        {saved && <Alert tone="success">{saved === 'saved' ? t('saved') : t('resetDone')}</Alert>}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending !== null || !dirty}>
            {pending === 'save' && <Spinner label={t('saving')} />}
            {pending === 'save' ? t('saving') : t('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending !== null || value === ''}
            onClick={() => {
              setValue('');
              setFieldError(null);
              setSaved(null);
              document.getElementById(`${uid}-footer`)?.focus();
            }}
          >
            {t('clear')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending !== null || usingDefault}
            onClick={() => void send(null, 'reset')}
          >
            {pending === 'reset' && <Spinner label={t('saving')} />}
            {t('reset')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
