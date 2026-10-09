'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Drawer } from '@crm/ui';
import { LogsPanel } from './logs-panel';
import { useLocalPaging } from './use-paging';

/** The "Logs" button of a list row: the runs of that one API, newest first. */
export function ApiLogsDrawer({
  api,
  onClose,
}: {
  api: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations('api-library.logs');
  const tc = useTranslations('api-library.common');
  const paging = useLocalPaging();
  return (
    <Drawer
      open={api !== null}
      onClose={onClose}
      title={t('drawerTitle', { name: api?.name ?? '' })}
      closeLabel={tc('close')}
      className="w-[min(60rem,100vw)]"
    >
      {api && (
        <div className="space-y-4">
          <LogsPanel apiId={api.id} paging={paging} />
          <Link href="/api-library/logs" className="text-sm text-primary underline">
            {t('allLogs')}
          </Link>
        </div>
      )}
    </Drawer>
  );
}
