'use client';

import { useTranslations } from 'next-intl';

/**
 * What a visitor sees when the form cannot be shown. The same words for an unknown address, a closed form and a workspace that no
 * longer has the app, so the page never confirms that a key exists. `closed` is a paused form (the API says so itself), `error` the
 * transient case (the service did not answer).
 */
export function UnavailableForm({ kind }: { kind: 'missing' | 'closed' | 'error' }) {
  const t = useTranslations('web-forms.public');
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
          {kind === 'closed' ? t('closedTitle') : t('notAvailableTitle')}
        </h1>
        <p style={{ margin: 0, opacity: 0.75 }}>
          {kind === 'error'
            ? t('genericError')
            : kind === 'closed'
              ? t('closed')
              : t('notAvailableBody')}
        </p>
      </div>
    </main>
  );
}
