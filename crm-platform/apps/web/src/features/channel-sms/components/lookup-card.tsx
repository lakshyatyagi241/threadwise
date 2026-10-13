'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, cn } from '@crm/ui';
import type { SmsLookupResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { lookupNumber } from '../api/sms';
import { canLookup, isKnownKind, lookupTone, type LookupTone } from '../lib/lookup-model';

const TONE: Record<LookupTone, string> = {
  good: 'text-success',
  bad: 'text-danger',
  warn: 'text-warning',
  neutral: 'text-muted-foreground',
};

/** "Check a number before you text it" (TW-SMS-008): mobile, landline or invalid, so money is not spent on a number that cannot receive. */
export function LookupCard() {
  const t = useTranslations('sms.lookup');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: LookupTone; text: string } | null>(null);

  const run = async () => {
    if (!canLookup(number)) {
      setResult(null);
      return;
    }
    setBusy(true);
    try {
      const r: SmsLookupResponse = await lookupNumber(number.trim());
      const base = isKnownKind(r.kind) ? t(`kind.${r.kind}`) : r.message;
      setResult({
        tone: lookupTone(r.kind),
        text: r.carrier ? `${base} ${t('carrier', { carrier: r.carrier })}` : base,
      });
    } catch (e) {
      // A refusal carries the server's sentence (for example "connect a Twilio number first"); anything else is a network failure.
      setResult({
        tone: 'bad',
        text: e instanceof ApiError && e.status < 500 ? e.message : t('unreachable'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6">
      <div className="text-lg leading-tight">{t('title')}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input
          id="sms-lookup"
          type="tel"
          dir="ltr"
          aria-label={t('label')}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={t('placeholder')}
          className="font-mono sm:max-w-xs"
        />
        <Button type="submit" className="rounded-full" disabled={busy}>
          {busy ? t('checking') : t('check')}
        </Button>
      </form>
      {result && (
        <p role="status" className={cn('mt-3 text-[13px]', TONE[result.tone])}>
          {result.text}
        </p>
      )}
    </div>
  );
}
