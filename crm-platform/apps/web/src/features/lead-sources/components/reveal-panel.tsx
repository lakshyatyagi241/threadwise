'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LEAD_HOOK_SECRET_HEADER } from '@crm/contracts';
import { Alert, Button, Checkbox } from '@crm/ui';
import { canDismiss, confirmReveal, sampleCurl, type Reveal } from '../lib/reveal';
import { CopyButton } from './ui';

/**
 * The one-time reveal of a source's URL and token (after create and after rotate). It lives only in the state of the component that
 * holds it: nothing here writes it anywhere, and it goes away only through "Done", which stays disabled until the person has
 * ticked "I have copied it". The old token of a rotation is already dead; the new one cannot be shown again.
 */
export function RevealPanel({
  reveal,
  hasSecret,
  onChange,
  onDone,
  extra,
}: {
  reveal: Reveal;
  hasSecret: boolean;
  onChange: (next: Reveal) => void;
  onDone: () => void;
  /** More content for the panel's own step (the wizard's "send a test lead"). */
  extra?: ReactNode;
}) {
  const t = useTranslations('lead-sources.reveal');
  // The server builds the complete address from the platform's configured public API address. Without one only the path is shown,
  // with the reason: a guessed origin would be a wrong address that never receives a lead.
  const shown = reveal.hookUrl ?? reveal.hookPath;

  return (
    <section
      aria-labelledby="ls-reveal-title"
      data-testid="token-reveal"
      className="space-y-4 rounded-md border border-warning/40 bg-warning/10 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id="ls-reveal-title" className="text-base font-semibold">
          {reveal.reason === 'rotated' ? t('titleRotated') : t('titleCreated')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {reveal.reason === 'rotated' ? t('bodyRotated') : t('bodyCreated')}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{t('url')}</div>
        <code
          dir="ltr"
          className="block overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-start text-xs"
        >
          {shown}
        </code>
        <CopyButton text={shown} label={t('copyUrl')} />
        {reveal.hookUrl === null && (
          <Alert tone="warning" className="text-xs" data-testid="hook-address-problem">
            {t(reveal.hookUrlProblem === 'base_url_not_public' ? 'notPublic' : 'noOrigin')}
          </Alert>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{t('token')}</div>
        <code
          dir="ltr"
          className="block overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-start text-xs"
        >
          {reveal.token}
        </code>
        <CopyButton text={reveal.token} label={t('copyToken')} />
      </div>

      {hasSecret && (
        <Alert tone="info" className="text-xs">
          {t('secretHint', { header: LEAD_HOOK_SECRET_HEADER })}
        </Alert>
      )}

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{t('sample')}</div>
        <p className="text-xs text-muted-foreground">{t('sampleHelp')}</p>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-md border border-border bg-background p-3 text-start text-xs"
        >
          {sampleCurl(reveal.hookUrl, hasSecret)}
        </pre>
      </div>

      {extra}

      <div className="space-y-3 border-t border-warning/30 pt-3">
        <Checkbox
          id="ls-reveal-copied"
          checked={reveal.confirmed}
          onChange={(e) => onChange(confirmReveal(reveal, e.target.checked))}
          label={t('copied')}
        />
        <Button type="button" disabled={!canDismiss(reveal)} onClick={onDone}>
          {t('done')}
        </Button>
        {!reveal.confirmed && <p className="text-xs text-muted-foreground">{t('doneHint')}</p>}
      </div>
    </section>
  );
}
