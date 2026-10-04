import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TAB_LINKS, parseTab } from '@/features/admin-console-shell/workspace-settings/logic';
import { WorkspaceSettingsPage } from '@/features/admin-console-shell/workspace-settings/workspace-settings-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin-console-shell.workspaceSettings');
  return { title: `${t('titleLead')} ${t('titleTail')}` };
}

export default async function WorkspaceSettingsRoute({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const raw = (await searchParams).tab;
  // A `?tab=` deep link to a pane that is another domain's page goes straight there.
  const target = TAB_LINKS[parseTab(Array.isArray(raw) ? raw[0] : raw)];
  if (target) redirect(target);
  return <WorkspaceSettingsPage />;
}
