'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Field, Modal, Textarea, useToast } from '@crm/ui';
import { connectManualSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, connectManual, startLogin } from '../api/facebook';
import { ChevronDownIcon, FB_BLUE, FacebookGlyph } from './fb-icons';

/**
 * "Connect your Facebook account" (WD-FB-002): log in with Facebook once and every Page the account manages is added, or paste a
 * Page access token for one Page. The login leaves this page and comes back to the hub with the outcome in the address.
 */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('facebook.connect');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [manual, setManual] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setManual(false);
    setToken('');
    setError(null);
    onClose();
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startLogin();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
      setBusy(false);
    }
  };

  const submitManual = async () => {
    const parsed = connectManualSchema.safeParse({ pageAccessToken: token });
    if (!parsed.success) {
      setError(t('tokenShape'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await connectManual(parsed.data.pageAccessToken);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(res.message, 'success');
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
      eyebrow={t('kicker')}
      title={
        <span className="flex items-center gap-2.5">
          <span
            className="grid size-8 place-items-center rounded-lg text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-4" />
          </span>
          {t('title')}
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
          <span className="font-mono">{t('footerLeft')}</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {t('footerRight')}
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {error}
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('intro')}</p>

        <button
          type="button"
          disabled={busy}
          onClick={() => void login()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ background: FB_BLUE }}
        >
          <FacebookGlyph className="size-4" />
          {t('continue')}
        </button>

        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t('or')}
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          aria-expanded={manual}
          onClick={() => setManual((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left hover:bg-muted"
        >
          <span className="text-[12.5px] font-medium">{t('manualToggle')}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
        {manual && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitManual();
            }}
          >
            <Field label={t('tokenLabel')} htmlFor="fb-page-token" hint={t('tokenHint')}>
              <Textarea
                id="fb-page-token"
                rows={3}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="EAAG…"
                className="font-mono text-xs"
              />
            </Field>
            <Button
              type="submit"
              className="w-full rounded-full"
              disabled={busy || token.trim() === ''}
            >
              {t('connectPage')}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
