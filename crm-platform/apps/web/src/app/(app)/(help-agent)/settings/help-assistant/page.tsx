import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsScreen } from '@/features/help-agent/components/settings-screen';
import { SettingsBack } from '@/features/settings-hub/settings-back';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help-agent.settingsPage');
  return { title: t('title') };
}

/** Settings > Help assistant: the workspace switch, with what is shared with the AI provider spelled out. */
export default async function HelpAssistantSettingsPage() {
  const t = await getTranslations('help-agent.settingsPage');
  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <SettingsBack always />
      <header className="space-y-2">
        <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
          {t('title')}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <SettingsScreen />
    </main>
  );
}
