'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wabaPlatformCallbackSchema, wabaWebhookStatusSchema } from '@crm/contracts';
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

/**
 * WD-WABA-002, 003: which of the four coexistence webhook fields (messages, smb_message_echoes, smb_app_state_sync, history) the
 * Meta app is subscribed to, with a one-click subscribe for the missing ones. Meta is asked only when the button is pressed.
 */
function WebhookFields() {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const status = useMutation({
    mutationFn: () => operatorFetch('/waba/webhook-status', { schema: wabaWebhookStatusSchema }),
  });
  const subscribe = useMutation({
    mutationFn: () =>
      operatorFetch('/waba/webhook-subscribe', { method: 'POST', schema: wabaWebhookStatusSchema }),
    onSuccess: (r) => {
      status.reset();
      void qc.invalidateQueries({ queryKey: ['platform', 'waba'] });
      return r;
    },
  });
  const r = subscribe.data ?? status.data;
  const failed = subscribe.error ?? status.error;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <div className="text-sm font-medium">{t('fieldsTitle')}</div>
        <p className="text-xs text-muted-foreground">{t('fieldsHint')}</p>
      </div>
      <Button
        variant="secondary"
        disabled={status.isPending}
        onClick={() => {
          subscribe.reset();
          status.mutate();
        }}
      >
        {status.isPending ? t('fieldsChecking') : t('fieldsCheck')}
      </Button>
      {failed && <Alert>{failed instanceof Error ? failed.message : t('unavailable')}</Alert>}
      {r?.error && <Alert>{r.error}</Alert>}
      {r && !r.error && (
        <div className="space-y-2 text-sm" data-testid="waba-webhook-fields">
          <p className={r.ok ? 'text-success' : 'text-warning'}>
            {r.subscribedNow ? t('fieldsSubscribed') : r.ok ? t('fieldsOk') : t('fieldsMissing')}
          </p>
          <ul className="space-y-0.5 font-mono text-xs">
            {[...r.subscribed.filter((f) => !r.missing.includes(f)), ...r.missing].map((f) => (
              <li key={f}>
                {r.missing.includes(f) ? '○' : '✓'} {f}{' '}
                {r.missing.includes(f) && (
                  <span className="text-warning">{t('fieldsMissingTag')}</span>
                )}
              </li>
            ))}
          </ul>
          {!r.ok && (
            <Button disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>
              {subscribe.isPending ? t('fieldsSubscribing') : t('fieldsSubscribe')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** WD-WABA-001: the read-only values to paste into the Meta app (WhatsApp › Configuration). */
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
      <div className="rounded-md border border-border p-3 text-sm">
        <span className="text-muted-foreground">{t('connected')}</span>{' '}
        <strong data-testid="waba-connected-count">{q.data.connectedWabas}</strong>
      </div>
      <CopyRow
        label={t('webhookUrl')}
        value={q.data.webhookUrl ?? t('noUrl')}
        hint={t('webhookHint', { fields: q.data.fields.join(', ') })}
      />
      <CopyRow label={t('verifyToken')} value={q.data.verifyToken} hint={t('verifyHint')} />
      <WebhookFields />
    </div>
  );
}
