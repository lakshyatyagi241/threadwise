'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { launcherAvatarSrc } from '@crm/contracts';
import { cn } from '@crm/ui';
import { IMAGE_MAX_BYTES } from './image-upload';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

/**
 * A dashed square that takes a picture: click it (or drop a file on it), see the picture in its place, replace it or remove it.
 * The file goes to the server and the address it comes back with is what the setting keeps.
 */
export function PictureTile({
  id,
  label,
  value,
  upload,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  upload: (file: File) => Promise<string>;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('chatbotWidget.whatsappBuilder.upload');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="min-w-0 flex-1" data-testid={`${id}-upload`}>
      <div className="relative">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex h-[88px] w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border-[1.5px] border-dashed border-border bg-muted/30 px-2 text-center transition',
            'hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60',
          )}
        >
          {value !== '' ? (
            <img
              src={launcherAvatarSrc(value)}
              alt=""
              className="max-h-[52px] max-w-full object-contain"
            />
          ) : null}
          <span className="text-[12.5px] font-bold text-foreground">{label}</span>
          <span className="text-[11px] text-muted-foreground">
            {busy ? t('uploading') : value !== '' ? t('replace') : t('choose')}
          </span>
        </button>
        {value !== '' ? (
          <button
            type="button"
            aria-label={t('remove')}
            title={t('remove')}
            disabled={busy}
            onClick={() => onChange('')}
            className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-foreground/70 text-[12px] leading-none text-background hover:bg-foreground"
          >
            ×
          </button>
        ) : null}
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT}
          tabIndex={-1}
          className="sr-only"
          aria-label={label}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error ? (
        <span role="alert" className="mt-1 block text-[11.5px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
