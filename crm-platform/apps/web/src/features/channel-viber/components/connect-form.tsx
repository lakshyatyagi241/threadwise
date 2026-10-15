'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Field, Input, useToast } from '@crm/ui';
import { connectViberChannelSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { connectChannel, KEYS } from '../api/viber';
import { VIBER } from './viber-icons';

/**
 * "Connect a channel": paste the auth token (TW-VIB-002). Reference keeps this form on the page, not in a dialog. A webhook Viber refuses
 * still saves the channel and says why.
 */
export function ConnectForm() {
  const t = useTranslations('viber.hub');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = connectViberChannelSchema.safeParse({ authToken: token });
    if (!parsed.success) {
      setError(t('tokenShape'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const channel = await connectChannel(parsed.data.authToken);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      setToken('');
      if (channel.webhookError) {
        toast(t('savedNeedsAttention'), 'info');
        toast(channel.webhookError, 'info');
      } else {
        toast(t('connected', { name: channel.name ?? '' }), 'success');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-background p-6 shadow-sm">
      <h2 className="text-[22px] leading-tight">{t('connectTitle')}</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{t('connectIntro')}</p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('tokenLabel')} htmlFor="viber-auth-token">
          <Input
            id="viber-auth-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            invalid={error !== null}
            placeholder={t('tokenPlaceholder')}
            className="font-mono text-xs"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || token.trim() === ''}
          className="inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: VIBER }}
        >
          {busy ? t('connecting') : t('connectButton')}
        </button>
      </form>
    </section>
  );
}
