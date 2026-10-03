import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceSettingsPage } from '@/features/admin-console-shell/workspace-settings/workspace-settings-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin-console-shell.workspaceSettings');
  return { title: `${t('titleLead')} ${t('titleTail')}` };
}

export default function WorkspaceSettingsRoute() {
  return <WorkspaceSettingsPage />;
}
