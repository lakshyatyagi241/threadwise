'use client';

import { useTranslations } from 'next-intl';
import type { FaqVerifyInfo } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { verifyKind, verifyTone } from '../lib/decision';

/** The result of the second check as a chip: it agreed, it said no, it could not run (the match stood) or it did not run. */
export function VerifyChip({ verify }: { verify: FaqVerifyInfo }) {
  const t = useTranslations('faq.verify.chip');
  const kind = verifyKind(verify);
  return <Badge tone={verifyTone(kind)}>{t(kind)}</Badge>;
}

/**
 * The second check in full: the chip, the model that judged, what that means for the customer (for a "no": why the answer was
 * withheld) and the model's own one-sentence reason, or why the check did not run.
 */
export function VerifyDetail({ verify }: { verify: FaqVerifyInfo }) {
  const t = useTranslations('faq.verify');
  const kind = verifyKind(verify);
  return (
    <div
      className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-sm"
      role="group"
      aria-label={t('title')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VerifyChip verify={verify} />
        {verify.model && (
          <span className="text-xs text-muted-foreground">
            {t('model')}: <span className="font-mono text-foreground">{verify.model}</span>
          </span>
        )}
      </div>
      <p className={kind === 'vetoed' ? 'font-medium' : 'text-muted-foreground'}>
        {t(`body.${kind}`)}
      </p>
      {verify.reason && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t('reason')}: </span>
          {verify.reason}
        </p>
      )}
    </div>
  );
}
