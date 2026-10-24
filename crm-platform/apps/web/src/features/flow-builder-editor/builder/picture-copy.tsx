'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { copyFlowMediaFromUrl } from '../lib/upload-media';

/**
 * A picture address that is a web address and not this server's own copy: the chat cannot be sure a visitor's browser may load it,
 * so the builder offers to keep a copy. A copy's address points at this server's flow media store.
 */
export const needsCopy = (url: string): boolean => {
  const v = url.trim();
  return /^https?:\/\//i.test(v) && !v.includes('/v2/flow-media/');
};

/** The "Save a copy" control under a Carousel card's picture address. Its result is handed to `onSaved`; a refusal to `onFailed`. */
export function SaveCopy({
  url,
  onSaved,
  onFailed,
}: {
  url: string;
  onSaved: (copy: string) => void;
  onFailed: (message: string) => void;
}) {
  const t = useTranslations('flb.builder.simple.editors.carousel');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const copy = await copyFlowMediaFromUrl(url);
      onSaved(copy.url);
    } catch (err) {
      onFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium hover:bg-muted disabled:opacity-60"
      >
        {busy ? t('saving') : t('saveCopy')}
      </button>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('saveCopyHint')}</p>
    </div>
  );
}
