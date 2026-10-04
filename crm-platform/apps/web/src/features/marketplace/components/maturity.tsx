'use client';

import { useTranslations } from 'next-intl';
import { Alert, Badge, cn } from '@crm/ui';
import { maturityView, type MaturitySource } from '../lib/portals';

/**
 * How far a listing can be trusted to work without the customer's help. A stable listing (or one that says nothing) draws nothing at
 * all; "Beta" and "Needs portal setup" each get a badge, and the operator's one-sentence notice says what to expect.
 */

/** The badge. Its tooltip is the operator's notice, or the general explanation of the badge when there is none. */
export function MaturityBadge({
  source,
  className,
}: {
  source: MaturitySource;
  className?: string;
}) {
  const t = useTranslations('marketplace.portals.maturity');
  const v = maturityView(source);
  if (!v.badge) return null;
  return (
    <Badge
      tone={v.badgeTone}
      title={v.notice ?? t(`${v.badge}Hint`)}
      className={cn('shrink-0', className)}
      data-testid="maturity-badge"
    >
      {t(v.badge)}
    </Badge>
  );
}

/**
 * The notice box of the app page and the install page: warning for a beta, plain information otherwise. `badge` puts the badge in
 * front of the sentence, for a page (the install page) that has no badge of its own beside the name.
 */
export function MaturityNotice({
  source,
  badge,
  className,
}: {
  source: MaturitySource;
  badge?: boolean;
  className?: string;
}) {
  const t = useTranslations('marketplace.portals.maturity');
  const v = maturityView(source);
  const text = v.notice ?? (v.badge ? t(`${v.badge}Hint`) : null);
  if (!text) return null;
  return (
    <Alert
      tone={v.alertTone}
      className={cn(badge && v.badge && 'flex flex-wrap items-start gap-2', className)}
      data-testid="maturity-notice"
    >
      {badge ? (
        <>
          <MaturityBadge source={source} className="mt-0.5" />
          <span className="min-w-0 flex-1 basis-60">{text}</span>
        </>
      ) : (
        text
      )}
    </Alert>
  );
}

/** One line on a card: the badge and, beside it, the notice cut to one line (the badge's tooltip holds all of it). Nothing for a stable app. */
export function MaturityLine({ source }: { source: MaturitySource }) {
  const v = maturityView(source);
  if (!v.badge) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <MaturityBadge source={source} />
      {v.notice && (
        <p className="line-clamp-1 min-w-0 text-xs text-muted-foreground" title={v.notice}>
          {v.notice}
        </p>
      )}
    </div>
  );
}
