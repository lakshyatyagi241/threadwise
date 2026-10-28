'use client';

import { useTranslations } from 'next-intl';
import { GetaLoader } from '@crm/ui';

/**
 * The loader of a page (or a block of a page) that is waiting for its first answer: Geta's branded loader, centred. Buttons and
 * other small spots keep the small `Spinner`; this one is for loading a page.
 */
export function PageLoader({ label, className }: { label: string; className?: string }) {
  return (
    <div className={className ?? 'grid min-h-[50vh] place-items-center'}>
      <GetaLoader logoSrc="/images/geta-logo.png" label={label} />
    </div>
  );
}

/** The same loader with the shared "Loading" label, for a server page's `Suspense` fallback (a server page cannot hand it a translated label). */
export function PageLoading() {
  const t = useTranslations('common');
  return <PageLoader label={t('loading')} />;
}
