'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { GetaDeploymentsView } from './geta-deployments-view';
import { PublishesView } from './publishes-view';

const NS = 'platform-deployments';

type Source = 'publishes' | 'geta';

/**
 * Operator console: what the platform is deploying. Two sources: every flow publish (the outbox event the worker handles), which is the
 * default, and the flow publishes pushed to the Geta console. Both are read-only and poll, so a change shows up without a reload.
 */
export function DeploymentsPage() {
  const t = useTranslations(NS);
  const [source, setSource] = useState<Source>('publishes');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t(source === 'publishes' ? 'publishes.description' : 'description')}
      />

      <div role="group" aria-label={t('tabs.label')} className="flex flex-wrap gap-2">
        {(['publishes', 'geta'] as const).map((id) => (
          <Button
            key={id}
            size="sm"
            variant={source === id ? 'primary' : 'secondary'}
            aria-pressed={source === id}
            onClick={() => setSource(id)}
          >
            {t(`tabs.${id}`)}
          </Button>
        ))}
      </div>

      {source === 'publishes' ? <PublishesView /> : <GetaDeploymentsView />}
    </div>
  );
}
