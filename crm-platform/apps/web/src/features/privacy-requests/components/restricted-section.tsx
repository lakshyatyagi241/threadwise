'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PrivacyRequest } from '@crm/contracts';
import { Alert, Button } from '@crm/ui';

/**
 * A case that waits on a legal hold (BL-295): the person's data is kept and locked, the erasure is not executed, and the deadline keeps
 * running. Shows what to tell the person: the workspace's own wording when it set one, else the default text. The text states that the data
 * is kept under a legal obligation and never names the matter, the category or the case reference.
 */
export function RestrictedSection({ request }: { request: PrivacyRequest }) {
  const t = useTranslations('privacy-requests.legalHold');
  const [copied, setCopied] = useState(false);
  const text = request.restrictionNotice ?? t('requesterResponse');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-4"
      data-testid="restricted-section"
    >
      <h2 className="text-sm font-semibold">{t('caseStatus')}</h2>
      <p className="text-sm">{t('case.body')}</p>
      <div className="space-y-2 rounded-md border border-border bg-background p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('case.requesterTitle')}
        </h3>
        <p className="whitespace-pre-line text-sm">{text}</p>
        <p className="text-xs text-muted-foreground">{t('case.requesterHint')}</p>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? t('case.copied') : t('case.copy')}
        </Button>
      </div>
      {request.allowed.erase && <Alert tone="info">{t('case.queueHint')}</Alert>}
    </section>
  );
}
