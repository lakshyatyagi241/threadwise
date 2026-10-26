'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';

/**
 * The upgrade sheet over a page the plan does not include. The server refuses every AI Training call on a plan without the AI
 * assistants feature, so the sheet is what tells the person why the page is empty.
 */
export function PlanPaywall() {
  const t = useTranslations('aiTraining.paywall');
  const upgrade = useRef<HTMLAnchorElement>(null);
  // The sheet covers the page and cannot be dismissed, so keyboard focus moves onto it when it opens and stays on its one control: Tab
  // never reaches the page behind it.
  useEffect(() => {
    upgrade.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aiag-paywall-title"
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          upgrade.current?.focus();
        }
      }}
      className="fixed inset-0 z-40 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
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
          ref={upgrade}
          href={PLAN_UPGRADE_PATH}
          className="mt-5 inline-flex h-10 items-center rounded-full bg-brand px-5 text-xs font-semibold text-brand-foreground hover:opacity-90"
        >
          {t('upgrade')}
        </Link>
      </div>
    </div>
  );
}
