'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { launcherAvatarSrc } from '@crm/contracts';

/** What the server accepts for a button picture. */
export const IMAGE_MAX_BYTES = 1_048_576;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

/**
 * Upload a picture for the button (the logo, the popup image): choose a file, see it, replace it or remove it. The file goes to the
 * server and the address it comes back with is what the button settings keep. Without an `upload` (the Chat widget page has no bot
 * to keep a file for) nothing is drawn: the address box beside it still works.
 */
export function ImageUpload({
  id,
  value,
  upload,
  onChange,
  shape = 'round',
}: {
  id: string;
  /** How the stored picture is drawn: a round chip (logo, avatar) or a wide thumbnail (background). */
  shape?: 'round' | 'wide';
  /** The stored picture: a built-in key, an address, or empty. */
  value: string;
  upload: ((file: File) => Promise<string>) | undefined;
  /** The address of the uploaded picture, or empty when it is removed. */
  onChange: (value: string) => void;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.upload');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!upload) return null;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > IMAGE_MAX_BYTES) {
      setError(t('tooLarge'));
      return;
    }
    setBusy(true);
    try {
      onChange(await upload(file));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3" data-testid={`${id}-upload`}>
      {value !== '' ? (
        <img
          src={launcherAvatarSrc(value)}
          alt=""
          className={
            shape === 'wide'
              ? 'h-12 w-20 rounded-lg border border-border object-cover'
              : 'size-12 rounded-full border border-border object-cover'
          }
        />
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
      >
        {busy ? t('uploading') : value !== '' ? t('replace') : t('choose')}
      </button>
      {value !== '' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onChange('')}
          className="text-[12.5px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {t('remove')}
        </button>
      ) : null}
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        className="sr-only"
        aria-label={t('choose')}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <span className="basis-full text-[11px] text-muted-foreground">{t('hint')}</span>
      {error ? (
        <span role="alert" className="basis-full text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
