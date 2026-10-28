import { getTranslations } from 'next-intl/server';
import { GetaLoader } from '@crm/ui';

/** What the sign-in, sign-up and the other guest pages show while a page is loading: Geta's branded loader, centred on the screen. */
export default async function Loading() {
  const t = await getTranslations('common');
  return <GetaLoader fullScreen logoSrc="/images/geta-logo.png" label={t('loading')} />;
}
