'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { controlClass, IconButton, XIcon } from '../kit';
import type { FormEnv } from '../types';
import type { HelperT, LinkedCopy } from './helpers';

/** Small building blocks shared by the core node forms. */

/** A `{{name}}` variable reference, set in mono like Reference's hints. */
export function V({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono">
      {'{{'}
      {children}
      {'}}'}
    </span>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono">{children}</span>
);

export function Link({
  href,
  children,
  strong,
  newTab,
}: {
  href: string;
  children: ReactNode;
  strong?: boolean;
  /** Opens beside the builder, so a screen elsewhere in the app never replaces a flow with unsaved changes. */
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn('text-brand underline', strong && 'font-semibold')}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

/** "text <link> text" copy where the link is the path itself. */
export function LinkedText({ copy, strong }: { copy: LinkedCopy; strong?: boolean }) {
  const t = useTranslations('flb.builder.formsCore.helpers');
  return (
    <>
      {t.rich(copy.key, {
        link: () => (
          <Link href={copy.href} strong={strong}>
            {copy.href}
          </Link>
        ),
      })}
    </>
  );
}

export const smallInputClass =
  'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-brand';

const UpIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-3 w-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <path d="M4 10l4-4 4 4" />
  </svg>
);
const DownIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-3 w-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
);

/** Header row of a repeated card: index, a control slot, then move up / move down / remove. */
export function CardHeader({
  index,
  children,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  index: number;
  children: ReactNode;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('flb.builder.formsCore.parts');
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2">
      <span className="font-mono text-[10px] text-muted-foreground">{index + 1}.</span>
      {children}
      <div className="flex-1" />
      <IconButton title={t('moveUp')} disabled={isFirst} onClick={() => onMove(-1)}>
        <UpIcon />
      </IconButton>
      <IconButton title={t('moveDown')} disabled={isLast} onClick={() => onMove(1)}>
        <DownIcon />
      </IconButton>
      <IconButton title={t('remove')} danger onClick={onRemove}>
        <XIcon />
      </IconButton>
    </div>
  );
}

/** One editable text option (buttons / ask / poll): numbered input and a remove button. */
export function OptionRow({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: unknown;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('flb.builder.formsCore.parts');
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-5 font-mono text-[10px] text-muted-foreground">{index + 1}.</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlClass, 'flex-1 !w-auto')}
      />
      <button
        type="button"
        onClick={onRemove}
        title={t('remove')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#E87A5D] hover:bg-[#E87A5D]/15"
      >
        <XIcon />
      </button>
    </div>
  );
}

/** Text-link add button ("Add button", "Add rule" ...) in Reference's brand-coloured style. */
export function AddLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M8 3v10M3 8h10" strokeLinecap="round" />
      </svg>
      {children}
    </button>
  );
}

/** A plain bordered explanation box (no tone). */
export function InfoBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-[11.5px] leading-snug',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The dashed "Choose a file" picker. Resets its value so the same file can be picked again. */
export function UploadBox({
  accept,
  label,
  compact,
  onFile,
}: {
  accept: string;
  label: string;
  compact?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label
      className={cn(
        'block w-full cursor-pointer rounded-lg border border-dashed border-brand/50 bg-muted/60 text-center text-brand transition hover:bg-brand/5',
        compact ? 'px-3 py-2 text-[11.5px]' : 'px-3 py-3 text-[12px]',
      )}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Uploads through the builder and reports a failure as Reference's "Upload failed: <message>" toast.
 * `t` is the `flb.builder.formsCore.parts` translator of the calling form.
 */
export function uploadFile(
  t: HelperT,
  env: FormEnv,
  file: File,
  kind: 'image' | 'video' | 'audio' | 'document',
  onDone: (res: { url: string; filename: string }) => void,
): void {
  env
    .uploadMedia(file, kind)
    .then((res) => {
      if (res.url) onDone({ url: res.url, filename: res.filename || file.name });
    })
    .catch((err: unknown) => {
      env.toast(t('uploadFailed', { message: err instanceof Error ? err.message : String(err) }));
    });
}

/** Thumbnail (image) or 3-letter badge plus the filename and link of an uploaded file. */
export function UploadedFile({
  kind,
  url,
  filename,
  size = 'md',
}: {
  kind: string;
  url: string;
  filename: string;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('flb.builder.formsCore.parts');
  const box = size === 'md' ? 'h-16 w-16' : 'h-14 w-14';
  return (
    <div className="mt-2 flex items-start gap-2">
      {kind === 'image' ? (
        <img src={url} alt="" className={cn(box, 'rounded-md border border-border object-cover')} />
      ) : kind === 'video' ? (
        <video
          src={url}
          controls
          preload="metadata"
          className={cn(
            size === 'md' ? 'h-24 w-40' : 'h-20 w-32',
            'rounded-md border border-border bg-black',
          )}
        />
      ) : kind === 'audio' ? (
        <audio src={url} controls preload="metadata" className="h-9 w-48 max-w-full" />
      ) : (
        <span
          className={cn(
            box,
            'grid place-items-center rounded-md bg-muted font-mono text-[10px] uppercase text-foreground/80',
          )}
        >
          {(kind || 'file').slice(0, 3)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-foreground/80">
          {filename || t('uploadedFallback')}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-mono text-[10.5px] text-brand hover:underline"
        >
          {url}
        </a>
      </div>
    </div>
  );
}
