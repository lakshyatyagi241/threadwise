'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@crm/ui';

const NS = 'platform-settings-branding-storage.googleCallback';

/**
 * TW-APPT-028: the read-only address to register on the Google OAuth client (Authorised redirect URIs). The server works it out from
 * what is saved, the environment and the API's own origin, so what is shown is what the connect flow will actually send to Google.
 */
export function GoogleCallback({ uri }: { uri: string }) {
  const t = useTranslations(NS);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{t('redirectTitle')}</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={uri}
          dir="ltr"
          aria-label={t('redirectTitle')}
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-muted px-3 font-mono text-xs"
        />
        <Button
          variant="secondary"
          disabled={!uri}
          onClick={() => {
            void navigator.clipboard?.writeText(uri).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('redirectHint')}</p>
    </div>
  );
}
