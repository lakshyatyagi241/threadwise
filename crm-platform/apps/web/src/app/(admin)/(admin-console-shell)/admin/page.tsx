import { getTranslations } from 'next-intl/server';

export default async function AdminHome() {
  const t = await getTranslations('shell.admin');
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('note')}</p>
    </section>
  );
}
