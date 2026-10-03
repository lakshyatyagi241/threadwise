'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@crm/ui';
import { DataTab } from './data-tab';
import { GeneralTab } from './general-tab';
import { parseTab } from './logic';
import { NotificationsTab } from './notifications-tab';

const NS = 'admin-console-shell.workspaceSettings';

/** TW-ASHELL-032: the workspace Settings tab shell (`?tab=` selects, like Reference's `/settings?tab=`). */
export function WorkspaceSettingsPage() {
  const t = useTranslations(NS);
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get('tab'));
  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('titleLead')} <span className="italic text-primary">{t('titleTail')}</span>
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Tabs
        value={tab}
        onValueChange={(id) => router.replace(`${path}?tab=${id}`)}
        items={[
          { id: 'general', label: t('tabs.general'), content: <GeneralTab /> },
          { id: 'notifications', label: t('tabs.notifications'), content: <NotificationsTab /> },
          { id: 'data', label: t('tabs.data'), content: <DataTab /> },
        ]}
      />
    </section>
  );
}
