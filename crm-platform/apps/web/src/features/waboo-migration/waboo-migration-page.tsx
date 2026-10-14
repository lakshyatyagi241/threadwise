'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Tabs } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { BatchDetail } from './batch-detail';
import { BatchesList } from './batches-list';
import { BulkForm } from './bulk-form';
import { MigrateForm } from './migrate-form';
import { RunDetail } from './run-detail';
import { RunnerBanner } from './runner-banner';
import { RunsList } from './runs-list';

const NS = 'waboo-migration.page';

/** Platform operator page: start a Waboo migration for one organization or many (dry run first), follow it live, read the verdict. */
export function WabooMigrationPage() {
  const t = useTranslations(NS);
  const tr = useTranslations('waboo-migration.runs');
  const tb = useTranslations('waboo-migration.batches');
  const { operator } = useOperator();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {operator.role !== 'super_admin' ? (
        <Alert tone="info">{t('superOnly')}</Alert>
      ) : (
        <>
          <Alert tone="info">{t('banner')}</Alert>
          <RunnerBanner />
          <Tabs
            items={[
              {
                id: 'single',
                label: t('tabSingle'),
                content: <MigrateForm onStarted={(run) => setSelectedRun(run.id)} />,
              },
              {
                id: 'bulk',
                label: t('tabBulk'),
                content: <BulkForm onStarted={(batch) => setSelectedBatch(batch.id)} />,
              },
            ]}
          />
          {selectedBatch && (
            <BatchDetail
              key={selectedBatch}
              id={selectedBatch}
              onClose={() => setSelectedBatch(null)}
            />
          )}
          {selectedRun && (
            <RunDetail key={selectedRun} id={selectedRun} onClose={() => setSelectedRun(null)} />
          )}
          <section className="space-y-3">
            <h2 className="text-base font-semibold">{tb('title')}</h2>
            <BatchesList selected={selectedBatch} onSelect={setSelectedBatch} />
          </section>
          <section className="space-y-3">
            <h2 className="text-base font-semibold">{tr('title')}</h2>
            <RunsList selected={selectedRun} onSelect={setSelectedRun} />
          </section>
        </>
      )}
    </div>
  );
}
