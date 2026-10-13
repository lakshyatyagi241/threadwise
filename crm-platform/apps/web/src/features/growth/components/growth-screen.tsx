'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { GrowthSettings } from '@crm/contracts';
import { Alert, Tabs, type TabItem } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useGrowthDigest, useGrowthSettings } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { AssistantTab } from './assistant-tab';
import { AudiencesTab } from './audiences-tab';
import { AutoStageTab } from './auto-stage-tab';
import { CampaignsTab } from './campaigns-tab';
import { ControlsTab } from './controls-tab';
import { InboxTab } from './inbox-tab';
import { InsightsTab } from './insights-tab';
import { LoadError, NoAccess, SkeletonRows } from './parts';

/** The tabs a workspace sees: a part that is switched off hides its tab (Controls is always there to switch it on). */
export function visibleTabs(s: Pick<GrowthSettings, 'features'>): string[] {
  const f = s.features;
  return [
    'inbox',
    ...(f.engagement_audiences || f.service_rules ? ['audiences'] : []),
    ...(f.campaign_response ? ['campaigns'] : []),
    ...(f.send_times || f.propensity || f.quality || f.enrichment ? ['insights'] : []),
    ...(f.auto_stage ? ['autoStage'] : []),
    ...(f.broadcast_assistant ? ['assistant'] : []),
    'controls',
  ];
}

/** `/growth`: the pilot's one screen. Not shown at all to a workspace that is not in the pilot. */
export function GrowthScreen() {
  const t = useTranslations('growth.page');
  const canRead = useCan('lsc.runs.read');
  const q = useGrowthSettings(canRead);
  const [tab, setTab] = useState('inbox');

  if (!canRead) return <NoAccess permission="lsc.runs.read" />;
  if (q.isError)
    return (
      <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <SkeletonRows rows={5} />;
  if (!q.data.available) {
    return (
      <Alert tone="info">
        <p className="font-medium">{t('notAvailableTitle')}</p>
        <p className="mt-1">{t('notAvailable')}</p>
      </Alert>
    );
  }
  const settings = q.data;
  const ids = visibleTabs(settings);
  const items: TabItem[] = ids.map((id) => ({
    id,
    label: t(`tabs.${id}`),
    content: tabBody(id, settings),
  }));
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {settings.features.daily_digest && <DigestStrip />}
      <Tabs items={items} value={ids.includes(tab) ? tab : 'inbox'} onValueChange={setTab} />
    </section>
  );
}

function tabBody(id: string, settings: GrowthSettings) {
  switch (id) {
    case 'audiences':
      return <AudiencesTab />;
    case 'campaigns':
      return <CampaignsTab />;
    case 'insights':
      return <InsightsTab features={settings.features} />;
    case 'autoStage':
      return <AutoStageTab />;
    case 'assistant':
      return <AssistantTab />;
    case 'controls':
      return <ControlsTab key={settings.rowVersion ?? 'first'} settings={settings} />;
    default:
      return <InboxTab />;
  }
}

/** Today's summary of the workspace, in a few plain sentences. */
function DigestStrip() {
  const t = useTranslations('growth.digest');
  const q = useGrowthDigest(true);
  if (!q.data) return null;
  return (
    <Alert tone="info">
      <p className="font-medium">{t('title')}</p>
      {q.data.highlights.length === 0 ? (
        <p className="mt-1">{t('quiet')}</p>
      ) : (
        <ul className="mt-1 list-disc ps-5">
          {q.data.highlights.map((h) => (
            <li key={h.key}>
              {t(`highlights.${h.key}` as 'highlights.hotLeads', { count: h.count })}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
