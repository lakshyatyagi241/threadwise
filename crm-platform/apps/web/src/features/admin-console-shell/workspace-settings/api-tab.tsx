'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@crm/ui';

const NS = 'admin-console-shell.workspaceSettings.api';

/**
 * WD-ASHELL-042: the informational "API and webhooks" pane, with no controls of its own. WaDesk showed the Sheets add-on key
 * status and the webhook counts here; both belong to the integration modules and are not served yet, so this pane carries the
 * explanation and the way to the integrations page (recorded as a partial in the parity doc).
 */
export function ApiTab() {
  const t = useTranslations(NS);
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-6">
        <h2 className="text-xl font-semibold">{t('restTitle')}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('rest1')}</li>
          <li>{t('rest2')}</li>
          <li>{t('rest3')}</li>
        </ul>
      </Card>
      <Card className="space-y-3 p-6">
        <h2 className="text-xl font-semibold">{t('webhooksTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('webhooksBody')}</p>
        <Link href="/addons" className="text-sm font-semibold text-primary hover:underline">
          {t('manage')}
        </Link>
      </Card>
    </div>
  );
}
