'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * The upgrade sheet over a page the plan does not include. The server refuses every AI Training call on a plan without the AI
 * assistants feature, so the sheet is what tells the person why the page is empty.
 *
 * A modal: on open, focus moves into the sheet and the page behind it is made inert, so Tab and screen readers stay on the sheet.
 * On close, focus goes back to the control that had it and the page is live again.
 */
export function PlanPaywall() {
  const t = useTranslations('aiTraining.paywall');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement;
    // The page behind is every sibling of the sheet's ancestors: the nav, the header and the page body.
    const behind: Element[] = [];
    for (
      let node: HTMLElement | null = dialog;
      node && node !== document.body;
      node = node.parentElement
    ) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          behind.push(sibling);
        }
      }
    }
    // Tab wraps inside the sheet, so focus never leaves it for the browser's own controls while it is open.
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onTab);
    dialog.focus();
    return () => {
      document.removeEventListener('keydown', onTab);
      for (const el of behind) el.removeAttribute('inert');
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aiag-paywall-title"
      tabIndex={-1}
      className="fixed inset-0 z-40 grid place-items-center bg-background/80 p-4 outline-none backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 text-center shadow-lg">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('kicker')}
        </div>
        <h2 id="aiag-paywall-title" className="text-2xl leading-tight">
          {t('title')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('body')}</p>
        <Link
          href={PLAN_UPGRADE_PATH}
          className="mt-5 inline-flex h-10 items-center rounded-full bg-brand px-5 text-xs font-semibold text-brand-foreground hover:opacity-90"
        >
          {t('upgrade')}
        </Link>
      </div>
    </div>
  );
}
