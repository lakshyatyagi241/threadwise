'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import type { MessageStatus } from '@crm/contracts';
import { WhatsappGlyph } from '@/features/channel-whatsapp-cloud';
import { errorCode, errorKind, requestIdOf } from '../lib/errors';
import { avatarColor, initials } from '../lib/time';
import { AlertIcon, CloseIcon, ClockIcon } from './icons';

/** The coloured initials circle; the colour is fixed per person. */
export function Avatar({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        avatarColor(id),
        size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-16 text-lg' : 'size-10 text-sm',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * A short coloured tag for the channel kind (WaDesk's channel badge): the WhatsApp mark for a WhatsApp number, three letters for the
 * rest. The name is the tooltip and the accessible name, so the icon is never the only way to tell channels apart.
 */
export function ChannelTag({
  kind,
  name,
  className,
  decorative = false,
}: {
  kind: string;
  name: string;
  className?: string;
  /** The name is written next to the tag: hide the tag from assistive technology instead of saying it twice. */
  decorative?: boolean;
}) {
  const whatsapp = kind === 'whatsapp_cloud';
  const label = kind === 'simulator' ? 'SIM' : kind.slice(0, 3).toUpperCase();
  return (
    <span
      title={name}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      data-channel-kind={kind}
      className={cn(
        'inline-flex h-4 items-center rounded px-1 text-[9px] font-semibold uppercase tracking-wide',
        whatsapp
          ? 'bg-success/15 text-success'
          : kind === 'simulator'
            ? 'bg-warning/15 text-warning'
            : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {whatsapp ? <WhatsappGlyph className="size-3" /> : label}
    </span>
  );
}

const TICK_BLUE = '#53bdeb';

/** WhatsApp-style delivery ticks. Colour is never the only signal: each state has its own shape and a spoken label. */
export function Ticks({ status }: { status: MessageStatus }) {
  const t = useTranslations('team-inbox-conversations.status');
  if (status === 'received') return null;
  const label = t(status);
  if (status === 'queued') {
    return (
      <span role="img" aria-label={label} title={label} className="inline-flex text-muted-foreground">
        <ClockIcon width={12} height={12} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span role="img" aria-label={label} title={label} className="inline-flex text-danger">
        <AlertIcon width={13} height={13} />
      </span>
    );
  }
  const double = status !== 'sent';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex"
      style={{ color: status === 'read' ? TICK_BLUE : undefined }}
    >
      <svg
        width={double ? 18 : 14}
        height="11"
        viewBox={double ? '0 0 24 12' : '0 0 18 12'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={status === 'read' ? '' : 'text-muted-foreground'}
        aria-hidden="true"
      >
        {double ? (
          <>
            <polyline points="2 6.5 6 10 13 1.5" />
            <polyline points="9 8 10 9 18 1.5" />
          </>
        ) : (
          <polyline points="2 6.5 6.5 10.5 16 1.5" />
        )}
      </svg>
    </span>
  );
}

/**
 * A slide-over panel on the native <dialog>. `modal` traps focus and dims the page (the contact panel on a phone); without it the
 * panel floats beside the page and leaves it usable (the simulator, which is watched while it is used). Escape closes either.
 */
export function Drawer({
  open,
  onClose,
  title,
  closeLabel,
  modal = true,
  children,
  className,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  modal?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (modal) el.showModal();
      else el.show();
    }
    if (!open && el.open) el.close();
  }, [open, modal]);

  // A non-modal <dialog> does not close itself on Escape.
  useEffect(() => {
    if (!open || modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, modal, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        if (modal && e.target === ref.current) onClose();
      }}
      className={cn(
        'fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-dvh w-[min(24rem,100vw)] max-w-none overflow-hidden border-s border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40',
        !open && 'hidden',
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}

/** A thrown error (or an error code) as a sentence, chosen by code; a generic failure carries the request id. */
export function useErrorText() {
  const t = useTranslations('team-inbox-conversations.errors');
  return (error: unknown) => {
    const code = typeof error === 'string' ? error : errorCode(error);
    const kind = errorKind(code);
    if (kind !== 'generic') return t(kind);
    const id = typeof error === 'string' ? undefined : requestIdOf(error);
    return id ? t('genericWithId', { id }) : t('generic');
  };
}
