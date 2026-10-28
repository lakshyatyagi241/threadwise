import { getTranslations } from 'next-intl/server';
import { GetaLoader } from '@crm/ui';

/** What the signed-in app shows while a page is loading: Geta's branded loader, centred in the content area. */
export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <GetaLoader logoSrc="/images/geta-logo.png" label={t('loading')} />
    </div>
  );
}
