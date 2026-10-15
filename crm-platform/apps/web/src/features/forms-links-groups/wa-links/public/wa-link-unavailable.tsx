'use client';

import { useTranslations } from 'next-intl';

/** What a visitor sees when a click-to-chat short link (`/l/:slug`) cannot be opened. */
export function WaLinkUnavailable({ kind }: { kind: 'missing' | 'gone' | 'error' }) {
  const t = useTranslations('forms-links-groups.links.public');
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px 16px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420 }} role="status">
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>
          {kind === 'gone' ? t('goneTitle') : kind === 'error' ? t('errorTitle') : t('missingTitle')}
        </h1>
        <p style={{ margin: 0, opacity: 0.75 }}>
          {kind === 'gone' ? t('goneBody') : kind === 'error' ? t('errorBody') : t('missingBody')}
        </p>
      </div>
    </main>
  );
}
