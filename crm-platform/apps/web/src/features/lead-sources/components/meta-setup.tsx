'use client';

import { useTranslations } from 'next-intl';
import type { MetaLeadAdsOverview } from '@crm/contracts';
import { Alert, Badge, Card } from '@crm/ui';
import { CopyButton } from './ui';

/**
 * What an administrator does in the Meta app dashboard so Meta can deliver leads: register the callback address, give Meta the
 * verify token this install holds, and subscribe the Page object to the `leadgen` field. Shown in full while no Meta app is set,
 * and as a collapsed reminder once one is. The verify token's value is never on the page: only whether the install holds one.
 */
export function MetaSetup({
  overview,
  canManage,
  collapsed,
}: {
  overview: MetaLeadAdsOverview;
  canManage: boolean;
  collapsed: boolean;
}) {
  const t = useTranslations('lead-sources.meta.setup');
  if (!canManage) return null;

  const body = (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">{t('intro')}</p>
      <div className="space-y-1.5">
        <div className="font-medium">{t('callbackUrl')}</div>
        <code
          dir="ltr"
          className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs"
          data-testid="meta-webhook-url"
        >
          {overview.webhookUrl}
        </code>
        <CopyButton text={overview.webhookUrl} label={t('copyUrl')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('verifyToken')}</span>
        <Badge
          tone={overview.verifyTokenConfigured ? 'success' : 'warning'}
          data-testid="meta-verify-token"
        >
          {overview.verifyTokenConfigured ? t('verifyTokenSet') : t('verifyTokenMissing')}
        </Badge>
      </div>
      {!overview.verifyTokenConfigured && <Alert tone="warning">{t('verifyTokenHelp')}</Alert>}
      <ol className="list-decimal space-y-1.5 ps-5">
        <li>{t('steps.callback')}</li>
        <li>{t('steps.verify')}</li>
        <li>{t('steps.subscribe', { field: 'leadgen' })}</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        {overview.usesLoginConfiguration
          ? t('scopesFromConfiguration')
          : t('scopes', { scopes: overview.requiredScopes.join(', ') })}
      </p>
    </div>
  );

  if (collapsed) {
    return (
      <details className="rounded-md border border-border" data-testid="meta-setup">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary">
          {t('summary')}
        </summary>
        <div className="border-t border-border p-4">{body}</div>
      </details>
    );
  }
  return (
    <Card className="space-y-3 p-5" data-testid="meta-setup">
      <h3 className="text-base font-semibold">{t('title')}</h3>
      {body}
    </Card>
  );
}
