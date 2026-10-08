'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { downloadWooPlugin } from '../api/ecom';
import { Panel, ResultLine, pillLink } from './ui';

/** Offers the store's companion WordPress plugin (WD-ECOM-032): needed for abandoned-cart steps and subscription payment failures. */
export function PluginCard({ storeId }: { storeId: string }) {
  const t = useTranslations('ecom.settings.plugin');
  const { toast } = useToast();
  const canConnect = useCan('ecom.connect');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null);

  if (!canConnect) return null;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadWooPlugin(storeId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(t('started'), 'success');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('title')} className="mt-4">
      <p className="text-[13px] text-muted-foreground">{t('body')}</p>
      <ol className="mt-3 list-decimal space-y-1 ps-5 text-[13px]">
        <li>{t('step1')}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          aria-busy={busy}
          className={pillLink}
        >
          {busy ? t('preparing') : t('download')}
        </button>
        <span className="text-xs text-muted-foreground">{t('secretNote')}</span>
      </div>
      {error && (
        <div className="mt-3">
          <ResultLine ok={false}>{error === 'forbidden' ? t('forbidden') : t('failed')}</ResultLine>
        </div>
      )}
    </Panel>
  );
}
