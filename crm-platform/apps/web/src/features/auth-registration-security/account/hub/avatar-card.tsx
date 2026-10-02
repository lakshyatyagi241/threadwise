'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Alert, Spinner, cn } from '@crm/ui';
import { ErrorNote } from '../../shared/error-note';
import { redirectOnGateError } from '../../shared/gate-errors';
import { CameraIcon } from '../../shared/icons';
import {
  AVATAR_TYPES,
  avatarTargetBytes,
  formatLimit,
  prepareAvatar,
} from '../../shared/image-downscale';
import { useSession } from '../../shared/session-context';
import { authApi, keys, uploadAvatar } from '../api';
import { avatarProblem } from './avatar-problem';
import { initialsOf } from './person-text';

type Pending =
  { kind: 'set'; url: string; base: string | null } | { kind: 'clear'; base: string | null };

/**
 * The photo in the account rail (WD-AUTH-026). The initials are always drawn as
 * the base and the picture sits on top of them, so the circle is never blank,
 * not even when the picture's address is broken. Picking a file shrinks it in
 * the browser (512 px, under the server's 1 MB, a small GIF is kept as picked),
 * shows it at once and uploads it; "Remove photo" clears it. WaDesk had no
 * remove button in the UI; the API route existed.
 */
export function AvatarCard() {
  const t = useTranslations('auth-registration-security.account.avatar');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useSession();
  // The server states how large a photo it keeps; the profile query is shared with the profile pane.
  const profile = useQuery({
    queryKey: keys.profile,
    queryFn: authApi.profile,
    staleTime: 60_000,
    retry: false,
  });
  const serverMax = profile.data?.avatarMaxBytes ?? 1024 * 1024;
  const size = formatLimit(serverMax, locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The address that failed to load; a different address (a new upload) tries again.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  // The optimistic state applies only while the session still shows the photo it was based on.
  const live = pending && pending.base === user.avatarUrl ? pending : null;
  const shown = live ? (live.kind === 'set' ? live.url : null) : user.avatarUrl;
  const name = user.displayName ?? user.fullName;
  const showImage = shown !== null && shown !== brokenUrl;

  const previewUrl = pending?.kind === 'set' ? pending.url : null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function describe(e: unknown): string | null {
    const problem = avatarProblem(e);
    return problem ? t(`errors.${problem}`, { size }) : null;
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setError(null);
    setNotice(null);
    setBusy('upload');
    try {
      const prepared = await prepareAvatar(file, avatarTargetBytes(serverMax));
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
      const text = describe(err);
      if (text) setNotice({ tone: 'danger', text });
      else setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex shrink-0 flex-col items-center gap-1.5 text-center">
        <div className="relative">
          <span
            role="img"
            aria-label={t('alt', { name })}
            className={cn(
              'relative grid size-20 place-items-center overflow-hidden rounded-full bg-primary text-2xl font-semibold text-primary-foreground lg:size-24 lg:text-3xl',
              busy === 'upload' && 'opacity-60',
            )}
          >
            <span aria-hidden="true">{initialsOf(name)}</span>
            {showImage && (
              <img
                src={shown}
                alt=""
                onError={() => setBrokenUrl(shown)}
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </span>
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
            className="absolute -bottom-1 end-0 flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
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
        <p className="hidden max-w-44 text-[11px] leading-snug text-muted-foreground lg:block">
          {t('hint', { size })}
        </p>
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
