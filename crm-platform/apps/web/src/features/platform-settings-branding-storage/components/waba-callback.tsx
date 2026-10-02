'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wabaPlatformCallbackSchema } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

const NS = 'platform-settings-branding-storage.wabaCallback';

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const t = useTranslations(NS);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          dir="ltr"
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-muted px-3 font-mono text-xs"
        />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** TW-WABA-001: the read-only values to paste into the Meta app (WhatsApp › Configuration). */
export function WabaCallback() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: ['platform', 'waba', 'callback'],
    queryFn: ({ signal }) =>
      operatorFetch('/waba/callback', { schema: wabaPlatformCallbackSchema, signal }),
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert>{t('unavailable')}</Alert>;
  return (
    <div className="space-y-3">
      <CopyRow
        label={t('webhookUrl')}
        value={q.data.webhookUrl ?? t('noUrl')}
        hint={t('webhookHint', { fields: q.data.fields.join(', ') })}
      />
      <CopyRow label={t('verifyToken')} value={q.data.verifyToken} hint={t('verifyHint')} />
    </div>
  );
}
