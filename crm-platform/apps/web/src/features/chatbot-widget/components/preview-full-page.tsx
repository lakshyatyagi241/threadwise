'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';

/** The button beside a live preview that opens it over the whole page, at its real size, and brings it back. */
export function FullPageButton({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations('chatbotWidget.fullPage');
  return (
    <button
      type="button"
      data-testid="preview-full-page"
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[12.5px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {open ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
      {open ? t('close') : t('open')}
    </button>
  );
}

/** The preview over the whole page (Escape closes it). The content is drawn at its own size, scrolling when the screen is smaller. */
export function FullPageView({
  onClose,
  label,
  header,
  children,
}: {
  onClose: () => void;
  label: string;
  /** What sits above the preview (its own switches), next to the button that closes the view. */
  header?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="preview-full-page-view"
      className="fixed inset-0 z-[80] flex flex-col gap-3 bg-muted p-4"
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {header}
        <FullPageButton open onToggle={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-background p-5">
        {children}
      </div>
    </div>,
    document.body,
  );
}
