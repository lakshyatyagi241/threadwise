'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Select, Spinner } from '@crm/ui';
import { uploadTemplateMedia } from '../api/media';
import {
  HEADER_KINDS,
  HEADER_MAX,
  isMediaKind,
  type FormState,
  type HeaderKind,
} from '../lib/form-model';
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, mediaProblem, megabytes } from '../lib/media';
import { ErrorAlert } from './error-line';
import { DocumentIcon, ImageIcon, PinIcon, VideoIcon } from './icons';
import { useErrorText } from './use-error-text';

/** WD-TPL-009: no header, a text header (one variable), a media header with an uploaded sample, or a location pin. */
export function HeaderSection({
  state,
  headerError,
  onKind,
  onText,
  onUploaded,
}: {
  state: FormState;
  headerError?: string;
  onKind: (k: HeaderKind) => void;
  onText: (v: string) => void;
  onUploaded: (r: { handle: string; fileName: string }) => void;
}) {
  const t = useTranslations('message-templates.form.header');
  const errorText = useErrorText();
  const base = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadTemplateMedia(file),
    onSuccess: (r) => onUploaded({ handle: r.handle, fileName: r.fileName }),
  });
  const kind = state.headerKind;

  function pick(file: File | undefined) {
    if (!file || !isMediaKind(kind)) return;
    const p = mediaProblem(kind, file);
    if (p) {
      setProblem(
        p === 'tooBig'
          ? t('tooBig', {
              size: megabytes(file.size),
              max: megabytes(MEDIA_MAX_BYTES[kind]),
              kind: t(`kind.${kind}`),
            })
          : t(p === 'wrongType' ? 'wrongType' : 'emptyFile'),
      );
      return;
    }
    setProblem(null);
    upload.mutate(file);
  }

  const Icon =
    kind === 'video'
      ? VideoIcon
      : kind === 'document'
        ? DocumentIcon
        : kind === 'location'
          ? PinIcon
          : ImageIcon;

  return (
    <div className="space-y-3">
      <Field label={t('type')} htmlFor={`${base}-kind`}>
        <Select
          id={`${base}-kind`}
          value={kind}
          onChange={(e) => onKind(e.target.value as HeaderKind)}
        >
          {HEADER_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </Select>
      </Field>

      {kind === 'text' && (
        <Field
          label={t('text')}
          htmlFor={`${base}-text`}
          hint={t('textHint', { used: state.headerText.length, max: HEADER_MAX })}
          error={headerError}
        >
          <Input
            id={`${base}-text`}
            value={state.headerText}
            maxLength={HEADER_MAX + 20}
            invalid={Boolean(headerError)}
            onChange={(e) => onText(e.target.value)}
          />
        </Field>
      )}

      {isMediaKind(kind) && (
        <div className="space-y-2">
          <span className="block text-sm font-medium" id={`${base}-file-label`}>
            {t('sample')}
          </span>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border p-3">
            <Icon className="size-6 text-muted-foreground" />
            <div className="min-w-0 flex-1 text-sm">
              {upload.isPending ? (
                <span className="flex items-center gap-2">
                  <Spinner /> {t('uploading')}
                </span>
              ) : state.headerFileName ? (
                <span className="break-all">{state.headerFileName}</span>
              ) : state.headerSampleUrl ? (
                <span className="text-muted-foreground">{t('keptSample')}</span>
              ) : (
                <span className="text-muted-foreground">{t('noFile')}</span>
              )}
              <p className="text-xs text-muted-foreground">{t('limits')}</p>
            </div>
            <input
              ref={input}
              id={`${base}-file`}
              type="file"
              className="sr-only"
              accept={MEDIA_ACCEPT[kind]}
              aria-labelledby={`${base}-file-label`}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {state.headerFileName || state.headerSampleUrl ? t('replace') : t('choose')}
            </Button>
          </div>
          {problem && <Alert tone="danger">{problem}</Alert>}
          {upload.isError && <ErrorAlert error={errorText(upload.error)} />}
          {headerError && (
            <p role="alert" className="text-xs text-danger">
              {headerError}
            </p>
          )}
        </div>
      )}

      {kind === 'location' && <p className="text-sm text-muted-foreground">{t('locationHelp')}</p>}
    </div>
  );
}
