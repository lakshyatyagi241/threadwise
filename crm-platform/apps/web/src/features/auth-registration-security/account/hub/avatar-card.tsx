'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Alert, Spinner, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { CameraIcon } from '../../shared/icons';
import { AVATAR_TYPES, ImageError, prepareAvatar } from '../../shared/image-downscale';
import { useSession } from '../../shared/session-context';
import { authApi, uploadAvatar } from '../api';

type Pending =
  { kind: 'set'; url: string; base: string | null } | { kind: 'clear'; base: string | null };

/**
 * The photo in the account rail (TW-AUTH-026): pick a file, it is shrunk in the
 * browser (512 px, under 1 MB), shown at once, and uploaded; "Remove photo"
 * clears it. Reference had no remove button in the UI; the API route existed.
 */
export function AvatarCard() {
  const t = useTranslations('auth-registration-security.account.avatar');
  const router = useRouter();
  const { user } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  // The optimistic state applies only while the session still shows the photo it was based on.
  const live = pending && pending.base === user.avatarUrl ? pending : null;
  const shown = live ? (live.kind === 'set' ? live.url : null) : user.avatarUrl;
  const name = user.displayName ?? user.fullName;

  const previewUrl = pending?.kind === 'set' ? pending.url : null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function describe(e: unknown): string | null {
    if (e instanceof ImageError) return t(`errors.${e.reason}`);
    if (e instanceof ApiError) {
      if (e.status === 413) return t('errors.too-large');
      if (e.code === ERROR_CODES.AUTH_UPLOAD_REJECTED || e.code === ERROR_CODES.VALIDATION_FAILED) {
        return t('errors.rejected');
      }
    }
    return null;
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setError(null);
    setNotice(null);
    setBusy('upload');
    try {
      const prepared = await prepareAvatar(file);
      setPending({ kind: 'set', url: URL.createObjectURL(prepared), base: user.avatarUrl });
      await uploadAvatar(prepared);
      setNotice({ tone: 'success', text: t('updated') });
      router.refresh();
    } catch (err) {
      setPending(null);
      if (redirectOnGateError(err, router.replace)) return;
      const text = describe(err);
      if (text) setNotice({ tone: 'danger', text });
      else setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy('remove');
    setPending({ kind: 'clear', base: user.avatarUrl });
    try {
      await authApi.removeAvatar();
      setNotice({ tone: 'success', text: t('removed') });
      router.refresh();
    } catch (err) {
      setPending(null);
      if (redirectOnGateError(err, router.replace)) return;
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex shrink-0 flex-col items-center gap-2 text-center">
        <div className="relative">
          {shown ? (
            <img
              src={shown}
              alt={t('alt', { name })}
              className={cn(
                'size-16 rounded-full border border-border object-cover lg:size-24',
                busy === 'upload' && 'opacity-60',
              )}
            />
          ) : (
            <span
              role="img"
              aria-label={t('alt', { name })}
              className="flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground lg:size-24 lg:text-3xl"
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full">
              <Spinner
                label={busy === 'upload' ? t('uploading') : t('removing')}
                className="text-foreground"
              />
            </span>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            aria-label={t('change')}
            title={t('change')}
            className="absolute -bottom-1 end-0 flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <CameraIcon />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            onChange={(e) => void onPick(e)}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
        {shown && (
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={busy !== null}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-danger hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            {t('remove')}
          </button>
        )}
      </div>
      {/* Notices wrap onto their own line under the avatar and name. */}
      <div aria-live="polite" className="order-last w-full basis-full empty:hidden">
        {notice && (
          <Alert tone={notice.tone === 'success' ? 'success' : 'danger'} className="text-start">
            {notice.text}
          </Alert>
        )}
        <ErrorNote error={error} className="text-start" />
      </div>
    </>
  );
}
