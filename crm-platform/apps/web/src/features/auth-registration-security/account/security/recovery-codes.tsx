'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox } from '@crm/ui';
import { copyText, downloadText } from '../../shared/clipboard';
import { CheckIcon, CopyIcon, DownloadIcon } from '../../shared/icons';

/**
 * The ten single-use recovery codes, shown exactly once (TW-AUTH-030). The page
 * will not let the person leave this view until they confirm they stored them,
 * and the browser warns if they try to close the tab first.
 */
export function RecoveryCodes({
  codes,
  title,
  onDone,
}: {
  codes: string[];
  title: string;
  onDone: () => void;
}) {
  const t = useTranslations('auth-registration-security.account.recovery');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function copy() {
    const ok = await copyText(codes.join('\n'));
    setCopied(ok);
    setCopyFailed(!ok);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <Alert tone="warning">{t('onlyOnce')}</Alert>

      <ol
        aria-label={t('listLabel')}
        className="grid grid-cols-1 gap-2 rounded-md border border-border bg-muted p-3 font-mono text-sm min-[420px]:grid-cols-2"
        dir="ltr"
      >
        {codes.map((code, i) => (
          <li key={code} className="flex items-center gap-2">
            <span className="w-5 text-end text-xs text-muted-foreground">{i + 1}</span>
            <span className="select-all tracking-wider">{code}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            downloadText('recovery-codes.txt', `${t('fileHeader')}\n\n${codes.join('\n')}\n`)
          }
        >
          <DownloadIcon />
          {t('download')}
        </Button>
      </div>
      {copyFailed && (
        <p role="alert" className="text-xs text-danger">
          {t('copyFailed')}
        </p>
      )}

      <Checkbox
        id="recovery-saved"
        checked={saved}
        onChange={(e) => setSaved(e.target.checked)}
        label={t('confirmSaved')}
      />
      <div className="flex justify-end">
        <Button type="button" onClick={onDone} disabled={!saved}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}
