'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { reportWindowSchema, type ReportScope, type ReportWindow } from '@crm/contracts';
import { Alert, Select } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { platformAccess, workspaceAccess, type ReportAccess } from '../lib/access';

/** What shows while CopilotKit, its styles and the canvas download: the shape of the page, not a spinner. */
export function WorkbenchSkeleton() {
  return (
    <div
      className="grid animate-pulse gap-4 lg:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]"
      aria-hidden="true"
      data-testid="reports-skeleton"
    >
      <div className="h-[28rem] rounded-md bg-muted lg:h-[calc(100dvh-13rem)]" />
      <div className="hidden space-y-3 lg:block">
        <div className="h-8 w-1/2 rounded-md bg-muted" />
        <div className="h-24 rounded-md bg-muted" />
        <div className="h-64 rounded-md bg-muted" />
      </div>
    </div>
  );
}

/** CopilotKit loads on arrival and never on the server, so the rest of the app never downloads it. */
const ReportWorkbench = dynamic(() => import('./report-workbench'), {
  ssr: false,
  loading: () => <WorkbenchSkeleton />,
});

export interface ReportsPageProps {
  scope: ReportScope;
}

/**
 * The Reports page: the workspace's at `/reports`, the operator console's at `/admin/reports`. The same screen with a `scope`.
 * It opens straight onto the chat; who may see it and who may change the document library comes from the session (workspace
 * permissions) or the operator's role.
 */
export function ReportsPage({ scope }: ReportsPageProps) {
  return scope === 'workspace' ? <WorkspaceReports /> : <PlatformReports />;
}

function WorkspaceReports() {
  const session = useSession();
  return <ReportsView scope="workspace" access={workspaceAccess(session.permissions)} />;
}

function PlatformReports() {
  const { operator } = useOperator();
  return <ReportsView scope="platform" access={platformAccess(operator.role)} />;
}

export function ReportsView({ scope, access }: { scope: ReportScope; access: ReportAccess }) {
  const t = useTranslations('report-copilot.page');
  const tw = useTranslations('report-copilot.panel.window');
  const [win, setWin] = useState<ReportWindow>('30d');

  return (
    <div className="space-y-4" data-testid="reports-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-serif text-2xl leading-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t(`description.${scope}`)}</p>
        </div>
        {access.canRead && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('window')}
            <Select
              className="h-9 w-auto"
              value={win}
              onChange={(e) => setWin(reportWindowSchema.parse(e.target.value))}
            >
              {reportWindowSchema.options.map((w) => (
                <option key={w} value={w}>
                  {tw(w)}
                </option>
              ))}
            </Select>
          </label>
        )}
      </header>
      {access.canRead ? (
        <ReportWorkbench scope={scope} canManage={access.canManage} win={win} />
      ) : (
        <Alert tone="warning">{t('noAccess')}</Alert>
      )}
    </div>
  );
}
