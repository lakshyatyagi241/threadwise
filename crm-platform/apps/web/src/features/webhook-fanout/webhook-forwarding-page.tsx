'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Tabs } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { FailuresPanel } from './failures-panel';
import { TargetsTable } from './targets-table';

const NS = 'webhook-fanout.page';

/** Platform operator page: where the one Meta webhook is forwarded, and the deliveries that failed. */
export function WebhookForwardingPage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const isSuper = operator.role === 'super_admin';
  const [tab, setTab] = useState('targets');
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          isSuper && (
            <Button
              onClick={() => {
                setTab('targets');
                setAdding(true);
              }}
            >
              {t('add')}
            </Button>
          )
        }
      />
      {!isSuper ? (
        <Alert tone="info">{t('superOnly')}</Alert>
      ) : (
        <>
          <Alert tone="info">{t('banner')}</Alert>
          <Tabs
            value={tab}
            onValueChange={setTab}
            items={[
              {
                id: 'targets',
                label: t('tabs.targets'),
                content: (
                  <TargetsTable
                    adding={adding}
                    onAdd={() => setAdding(true)}
                    onCloseAdd={() => setAdding(false)}
                  />
                ),
              },
              { id: 'failures', label: t('tabs.failures'), content: <FailuresPanel /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
