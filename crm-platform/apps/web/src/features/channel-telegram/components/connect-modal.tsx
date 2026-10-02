'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, useToast } from '@crm/ui';
import { connectBotSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { connectBot, KEYS } from '../api/telegram';
import { TelegramGlyph } from './tg-icons';

/** "Connect Telegram Bot": paste the @BotFather token (TW-TG-002). A refused webhook still saves the bot and says why. */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('telegram.connect');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setToken('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    const parsed = connectBotSchema.safeParse({ botToken: token });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('tokenShape'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bot = await connectBot(parsed.data.botToken);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(
        bot.webhookError ? t('savedNeedsAttention') : t('connected'),
        bot.webhookError ? 'info' : 'success',
      );
      if (bot.webhookError) toast(bot.webhookError, 'info');
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      closeLabel={t('close')}
      title={
        <span className="flex items-center gap-2.5">
          <span
            className="grid size-8 place-items-center rounded-xl text-white"
            style={{ background: '#229ED9' }}
          >
            <TelegramGlyph className="size-4" />
          </span>
          {t('title')}
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" className="rounded-full" onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            className="rounded-full text-white"
            style={{ background: '#229ED9' }}
            disabled={busy || token.trim() === ''}
            onClick={() => void submit()}
          >
            {t('submit')}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field label={t('tokenLabel')} htmlFor="tg-bot-token" error={error}>
          <Input
            id="tg-bot-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            invalid={error !== null}
            placeholder={t('tokenPlaceholder')}
            className="font-mono"
          />
        </Field>
        <div className="rounded-xl border border-border bg-muted/50 p-4 text-xs text-muted-foreground">
          <div className="mb-2 font-semibold text-foreground">{t('howTitle')}</div>
          <ol className="list-inside list-decimal space-y-1">
            <li>
              {t('how1a')}{' '}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand hover:underline"
              >
                @BotFather
              </a>{' '}
              {t('how1b')}
            </li>
            <li>
              {t('how2a')} <span className="font-mono">/newbot</span> {t('how2b')}
            </li>
            <li>{t('how3')}</li>
          </ol>
        </div>
      </form>
    </Modal>
  );
}
