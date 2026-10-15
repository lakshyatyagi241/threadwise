'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Field, Input, Textarea, useToast } from '@crm/ui';
import { connectLineChannelSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { connectChannel, KEYS } from '../api/line';
import { connectReady } from '../lib/channel-model';
import { LINE_GREEN } from './line-icons';

/** "Connect a channel": paste the Channel access token and Channel secret from the LINE console. A refused webhook still saves the channel and says why. */
export function ConnectForm() {
  const t = useTranslations('line.connect');
  const hub = useTranslations('line.hub');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = connectLineChannelSchema.safeParse({
      channelAccessToken: token,
      channelSecret: secret,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('failed'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const channel = await connectChannel(
        parsed.data.channelAccessToken,
        parsed.data.channelSecret,
      );
      await qc.invalidateQueries({ queryKey: KEYS.all });
      setToken('');
      setSecret('');
      if (channel.webhookError) {
        toast(t('savedNeedsAttention'), 'info');
        toast(channel.webhookError, 'info');
      } else {
        toast(t('connected', { name: channel.displayName ?? '' }), 'success');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-background p-6 shadow-sm">
      <h2 className="text-[22px] leading-tight">{hub('connectTitle')}</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{hub('connectBody')}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('tokenLabel')} htmlFor="line-channel-token">
          <Textarea
            id="line-channel-token"
            rows={3}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            placeholder={t('tokenPlaceholder')}
            className="font-mono text-xs"
          />
        </Field>
        <Field label={t('secretLabel')} htmlFor="line-channel-secret">
          <Input
            id="line-channel-secret"
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            placeholder={t('secretPlaceholder')}
            className="font-mono text-xs"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !connectReady(token, secret)}
          className="inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: LINE_GREEN }}
        >
          {t('submit')}
        </button>
      </form>
    </section>
  );
}
