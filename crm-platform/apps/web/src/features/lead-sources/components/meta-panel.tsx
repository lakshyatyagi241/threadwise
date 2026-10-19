'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert, Button, Card, EmptyState, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { usePlanFeature } from '@/lib/plan-features';
import { useMetaOverview } from '../meta-api';
import { useLeadsCan } from '../lib/permissions';
import type { PageCaps } from '../lib/meta-view';
import { MetaFailure } from './meta-failure';
import { MetaPageCard } from './meta-page-card';
import { MetaSetup } from './meta-setup';
import { Loading } from './ui';
import { useMetaLogin } from './use-meta-login';

export const META_PANEL_ID = 'meta-lead-forms-panel';

/** The two capabilities the Meta actions need: the lead pipeline's manage key, and the Facebook channel's (it stores Page tokens). */
export function useMetaCaps(): PageCaps {
  const can = useLeadsCan();
  const facebook = useCan('fb.pages.manage');
  return { manage: can.manage, facebook };
}

/**
 * Meta lead forms need Social leads AND the extra channels feature (Facebook). A plan without either is told so and the Meta calls are
 * never made: the API would refuse each of them with `PLAN_FEATURE_LOCKED`. Unknown plan (no provider) counts as on.
 */
export function useMetaPlanOn(): boolean {
  const leads = usePlanFeature('lead_sources');
  const channels = usePlanFeature('extra_channels');
  return leads && channels;
}

/**
 * Everything about Meta lead forms in one place: whether this install can talk to Meta at all, the connected Facebook Pages with
 * their lead sync, and (per Page) the form picker. It answers each state in words: no Meta app set, no Page connected, a Page that
 * needs lead access or a reconnect, a Meta call that failed.
 */
export function MetaPanel() {
  const t = useTranslations('lead-sources.meta');
  const tStates = useTranslations('lead-sources.states');
  const caps = useMetaCaps();
  const planOn = useMetaPlanOn();
  const overview = useMetaOverview(planOn);
  const login = useMetaLogin();
  const canLogin = caps.manage && caps.facebook;

  return (
    <section
      id={META_PANEL_ID}
      aria-labelledby={`${META_PANEL_ID}-title`}
      className="space-y-4"
      data-testid="meta-panel"
    >
      <div className="space-y-1">
        <h2 id={`${META_PANEL_ID}-title`} className="text-lg font-semibold">
          {t('heading')}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      {!planOn ? (
        <Alert tone="warning" className="space-y-2" data-testid="meta-failure" data-kind="locked">
          <p>{t('planLocked')}</p>
          <Link
            href={PLAN_UPGRADE_PATH}
            className="font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
          >
            {tStates('upgrade')}
          </Link>
        </Alert>
      ) : overview.isPending ? (
        <Loading label={t('loading')} />
      ) : overview.isError ? (
        <MetaFailure error={overview.error} onRetry={() => void overview.refetch()} />
      ) : !overview.data.configured ? (
        <NotConfigured
          manage={caps.manage}
          setup={<MetaSetup overview={overview.data} canManage={caps.manage} collapsed={false} />}
        />
      ) : (
        <>
          {overview.data.pages.length === 0 ? (
            <EmptyState
              title={t('noPages.title')}
              message={caps.manage ? t('noPages.body') : t('noPages.bodyNoManage')}
              actions={
                caps.manage ? (
                  <ConnectButton login={login} allowed={canLogin} label={t('connectPage')} />
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-4" aria-label={t('pagesLabel')}>
              {overview.data.pages.map((p) => (
                <li key={p.id}>
                  <MetaPageCard
                    page={p}
                    caps={caps}
                    usesLoginConfiguration={overview.data.usesLoginConfiguration}
                  />
                </li>
              ))}
            </ul>
          )}
          {login.error && <MetaFailure error={login.error} login={login} canLogin={canLogin} />}
          {caps.manage && overview.data.pages.length > 0 && (
            <ConnectButton login={login} allowed={canLogin} label={t('connectAnother')} secondary />
          )}
          <MetaSetup overview={overview.data} canManage={caps.manage} collapsed />
        </>
      )}
    </section>
  );
}

function NotConfigured({ manage, setup }: { manage: boolean; setup: ReactNode }) {
  const t = useTranslations('lead-sources.meta.notConfigured');
  return (
    <div className="space-y-4" data-testid="meta-not-configured">
      <Card className="space-y-2 p-5">
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{manage ? t('bodyManage') : t('body')}</p>
      </Card>
      {setup}
    </div>
  );
}

function ConnectButton({
  login,
  allowed,
  label,
  secondary,
}: {
  login: ReturnType<typeof useMetaLogin>;
  allowed: boolean;
  label: string;
  secondary?: boolean;
}) {
  const t = useTranslations('lead-sources.meta');
  return (
    <div className="space-y-1">
      <Button
        variant={secondary ? 'secondary' : 'primary'}
        disabled={!allowed || login.pending}
        onClick={login.run}
        data-testid="meta-connect"
        aria-describedby={allowed ? undefined : 'meta-connect-hint'}
      >
        {login.pending && <Spinner />}
        {label}
      </Button>
      {!allowed && (
        <Alert tone="info" id="meta-connect-hint" className="text-xs">
          {t('connectNeedsPermission', { permission: 'fb.pages.manage' })}
        </Alert>
      )}
    </div>
  );
}
