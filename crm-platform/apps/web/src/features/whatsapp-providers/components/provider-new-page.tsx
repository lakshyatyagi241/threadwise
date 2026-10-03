'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { PROVIDERS_PATH, ProviderForm } from './provider-form';
import { WapGate } from './ui';

const NS = 'whatsapp-providers.new';

/** Operator console: the Add provider wizard. Needs `platform.whatsapp_providers.manage`. */
export function ProviderNewPage() {
  const t = useTranslations(NS);
  return (
    <WapGate need={['manage']}>
      {() => (
        <div className="space-y-6">
          <Link
            href={PROVIDERS_PATH}
            className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('back')}
          </Link>
          <PageHeader title={t('title')} description={t('description')} />
          <ProviderForm mode="create" />
        </div>
      )}
    </WapGate>
  );
}
