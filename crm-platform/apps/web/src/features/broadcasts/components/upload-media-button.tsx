'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import type { MarketingMedia } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { uploadMarketingMedia } from '../api/marketing-media';

/**
 * "Upload a file" beside an address box: sends the file to the workspace's storage and hands back the address. Shared by the
 * broadcast override panel, campaigns, Telegram broadcasts and Facebook posts.
 */
export function UploadMediaButton({
  onUploaded,
  accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt',
  disabled,
}: {
  onUploaded: (media: MarketingMedia) => void;
  accept?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('broadcasts.mediaUpload');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadMarketingMedia(file));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? t('uploading') : t('upload')}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}
