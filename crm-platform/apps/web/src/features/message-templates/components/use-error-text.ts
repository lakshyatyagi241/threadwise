'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';
import { MEDIA_MAX_BYTES } from '../lib/media';
import type { TplAttachment } from '../lib/form-model';

export interface ErrorText {
  text: string;
  /** The server's own words, shown for the codes where they matter (Meta's reason, the lint list). */
  detail?: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
  code?: string;
}

/** The file formats Meta takes for each kind of header or card file (format names, the same in every language). */
const FORMATS = {
  image: 'JPG / PNG',
  video: 'MP4 / 3GP',
  document: 'PDF',
  any: 'JPG, PNG, MP4, 3GP, PDF',
} as const;

/** The upload messages are English in every language (an English sentence with a translated noun in it reads badly). */
const KIND_WORD: Record<TplAttachment, string> = {
  image: 'picture',
  video: 'video',
  document: 'PDF',
};

/** Codes whose `detail` is the point: Meta's own reason for a refusal. */
const SHOWS_DETAIL = new Set(['TPL_META_REJECTED']);

/** Branches on the problem `code`, never on the message. Unknown codes fall back to a generic line plus the request id. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('message-templates.errors');
  return (e) => {
    if (e instanceof ApiError) {
      return {
        text: t.has(e.code) ? t(e.code) : t('generic'),
        detail: SHOWS_DETAIL.has(e.code) ? e.message : undefined,
        requestId: e.requestId,
        fieldErrors: e.fieldErrors,
        code: e.code,
      };
    }
    return { text: t('generic'), fieldErrors: [] };
  };
}

/**
 * The words for a failed upload of a header or card file. The file's own problem is the point, so a refusal names it: too big, wrong
 * kind, the provider's limit, or the server's own sentence when no fixed text fits (never the bare "Something went wrong").
 */
export function useUploadErrorText(): (e: unknown, kind?: TplAttachment) => ErrorText {
  const base = useErrorText();
  const t = useTranslations('message-templates.errors');
  return (e, kind) => {
    const r = base(e);
    if (!(e instanceof ApiError)) return { ...r, text: t('uploadNetwork') };
    const fixed: Record<string, string> = {
      PAYLOAD_TOO_LARGE: 'uploadTooLarge',
      AUTH_UPLOAD_REJECTED: 'uploadRejected',
      WABA_PROVIDER_UNAVAILABLE: 'uploadProviderDown',
      RATE_LIMITED: 'uploadRateLimited',
      TPL_HEADER_STORAGE_REQUIRED: 'TPL_HEADER_STORAGE_REQUIRED',
      TPL_NO_CONNECTION: 'TPL_NO_CONNECTION',
    };
    const byStatus = e.status === 413 ? 'uploadTooLarge' : null;
    const key = fixed[e.code] ?? byStatus;
    if (key === 'uploadTooLarge' || key === 'uploadRejected') {
      // The limit and the accepted formats are the ones of the kind of file the person chose, not all three at once.
      const text =
        key === 'uploadTooLarge'
          ? kind
            ? t('uploadTooLarge', {
                kind: KIND_WORD[kind],
                max: Math.round(MEDIA_MAX_BYTES[kind] / (1024 * 1024)),
              })
            : t('uploadTooLargeAny')
          : t('uploadRejected', { formats: kind ? FORMATS[kind] : FORMATS.any });
      return { ...r, text, detail: undefined };
    }
    if (key) return { ...r, text: t(key), detail: undefined };
    // Anything else: the server's own sentence says what is wrong with the file (type, Meta's reason, a failed scan).
    return {
      ...r,
      text: t('uploadRefused'),
      detail: e.code === 'INTERNAL' || e.code === 'UNKNOWN' ? undefined : e.message,
    };
  };
}
