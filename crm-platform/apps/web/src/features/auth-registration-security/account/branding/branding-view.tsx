'use client';

import { ERROR_CODES, updateBrandingRequestSchema, type BrandingResponse } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { useSession } from '../../shared/session-context';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { PLANS_PATH } from '../plans/plan-format';
import { FOOTER_MAX, clampCodePoints, codePointLength, footerPreview } from './footer-text';

const BRANDING_PERMISSION = 'auth.branding.update';

/** `showHeading` is false where the page already carries the title and description (the Settings page). */
export function BrandingView({ showHeading = true }: { showHeading?: boolean }) {
  const c = useTranslations('auth-registration-security.account.common');
  const { permissions, user } = useSession();
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
  return (
    <BrandingPane
      data={query.data}
      hasPermission={hasPermission}
      name={user.displayName ?? user.fullName}
      showHeading={showHeading}
    />
  );
}

/** Preview of an outgoing message with its footer in WhatsApp italics (`_text_`). Pure presentation. */
function FooterPreview({ footer }: { footer: string }) {
  const t = useTranslations('auth-registration-security.account.branding');
  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('preview')}
      </p>
      <p>{t('sampleMessage')}</p>
      <p
        className="mt-1 whitespace-pre-wrap break-words italic text-muted-foreground"
        data-testid="footer-preview"
      >
        {footerPreview(footer, t('noFooter'))}
      </p>
    </div>
  );
}

function BrandingPane({
  data,
  hasPermission,
  name,
  showHeading,
}: {
  data: BrandingResponse;
  hasPermission: boolean;
  /** The person's name, for the "Sent via ..." placeholder. */
  name: string;
  showHeading: boolean;
}) {
  const t = useTranslations('auth-registration-security.account.branding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();
  // What the workspace saved; nothing saved reads as blank (on a plan that removes branding both send no footer).
  const [value, setValue] = useState(data.messageFooter ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'removed' | null>(null);

  const editable = data.canEdit && hasPermission;
  const length = codePointLength(value);

  const explain = !data.canEdit ? t('planLocked') : !hasPermission ? t('permissionLocked') : null;

  async function send(messageFooter: string, outcome: 'saved' | 'removed' = 'saved') {
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await authApi.updateBranding({ messageFooter });
      queryClient.setQueryData(keys.branding, updated);
      setValue(updated.messageFooter ?? '');
      setSaved(outcome);
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
      } else if (err instanceof ApiError && err.code === ERROR_CODES.VALIDATION_FAILED) {
        setFieldError(t('tooLong', { max: FOOTER_MAX }));
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    // Like Reference's Save, always live; blank is a deliberate "no footer".
    const parsed = updateBrandingRequestSchema.safeParse({ messageFooter: value });
    if (!parsed.success || parsed.data.messageFooter === null) {
      setFieldError(t('tooLong', { max: FOOTER_MAX }));
      document.getElementById(`${uid}-footer`)?.focus();
      return;
    }
    setFieldError(null);
    void send(parsed.data.messageFooter);
  }

  if (!editable) {
    return (
      <Card className="max-w-2xl space-y-4 p-5">
        {showHeading && (
          <>
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </>
        )}
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {!data.canEdit ? t('currentDefault') : t('current')}
          </p>
          <p
            className="rounded-md border border-border bg-muted px-3 py-2 text-sm italic"
            data-testid="current-footer"
          >
            {footerPreview(data.effective, t('noFooter'))}
          </p>
        </div>
        {explain && (
          <Alert
            tone="warning"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <span className="min-w-0 flex-1">
              {!data.canEdit && <strong className="font-semibold">{t('upgradeTitle')} </strong>}
              {explain}
            </span>
            {!data.canEdit && (
              <Link
                href={PLANS_PATH}
                className="shrink-0 font-semibold underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('upgrade')}
                <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                  {' →'}
                </span>
              </Link>
            )}
          </Alert>
        )}
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl space-y-5 p-5">
      {showHeading && (
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t('label', { max: FOOTER_MAX })} htmlFor={`${uid}-footer`} error={fieldError}>
          <Textarea
            id={`${uid}-footer`}
            rows={2}
            value={value}
            onChange={(e) => {
              setValue(clampCodePoints(e.target.value));
              setFieldError(null);
              setSaved(null);
            }}
            invalid={Boolean(fieldError)}
            placeholder={t('placeholder', { name })}
            aria-describedby={`${uid}-meta`}
            className="resize-none"
          />
          <p
            id={`${uid}-meta`}
            className="flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground"
          >
            <span>{t('hint')}</span>
            <span dir="ltr" className="shrink-0" aria-live="off">
              {length}/{FOOTER_MAX}
            </span>
          </p>
        </Field>

        <FooterPreview footer={value} />

        <ErrorNote error={error} />
        {saved && <Alert tone="success">{t(saved === 'removed' ? 'removed' : 'saved')}</Alert>}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner label={t('saving')} />}
            {pending ? t('saving') : t('save')}
          </Button>
          {/* On a plan that removes branding, no footer is a real choice (the platform's line never applies): say it
              plainly and do it now, instead of leaving an empty box that still needs saving. */}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !data.messageFooter}
            onClick={() => {
              setValue('');
              setFieldError(null);
              void send('', 'removed');
            }}
          >
            {t('remove')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
