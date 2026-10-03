import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { translationSettingsSchema } from '@crm/contracts';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.dpa');
  return { title: t('title') };
}

/** The workspace's current routing mode, or null when the caller may not read translation settings. */
async function currentResidency() {
  try {
    const at = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!at) return null;
    const res = await fetch(`${apiBase()}/v2/workspace/translation-settings`, {
      headers: { Authorization: `Bearer ${at}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    const parsed = translationSettingsSchema.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data.residency : null;
  } catch {
    return null;
  }
}

const PROVIDERS = [
  { id: 'mymemory', link: 'https://translatedlabs.com/legal', linkText: 'translatedlabs.com/legal' },
  { id: 'google_free', link: null, linkText: null },
  { id: 'deepl', link: 'https://www.deepl.com/en/pro-data-security', linkText: 'deepl.com/pro-data-security' },
  {
    id: 'google_cloud',
    link: 'https://cloud.google.com/terms/data-processing-addendum',
    linkText: 'cloud.google.com/terms/dpa',
  },
  { id: 'libre', link: null, linkText: null },
] as const;

/** The data processing information page (WD-CMS-052): which services may receive message text, and the routing mode. */
export default async function DataProcessingPage() {
  const t = await getTranslations('marketing-site-cms.dpa');
  const [site, residency] = await Promise.all([getSiteConfig(), currentResidency()]);
  const app = site?.brand.name ?? '';
  const card = 'space-y-3 rounded-2xl border border-border p-6';
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('eyebrow')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro', { app })}</p>
      </header>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t('leavesTitle')}</h2>
        <p className="text-sm">{t('leavesBody', { app })}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-border text-start text-muted-foreground">
              <tr>
                {(['provider', 'region', 'dataSent', 'providerDpa'] as const).map((c) => (
                  <th key={c} className="px-3 py-2 text-start font-mono text-[10px] uppercase tracking-[0.14em]">
                    {t(`cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PROVIDERS.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2.5 font-medium">{t(`providers.${p.id}.name`)}</td>
                  <td className="px-3 py-2.5">{t(`providers.${p.id}.region`)}</td>
                  <td className="px-3 py-2.5">{t(`providers.${p.id}.data`)}</td>
                  <td className="px-3 py-2.5">
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="underline">
                        {p.linkText}
                      </a>
                    ) : (
                      t(`providers.${p.id}.dpa`)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t('residencyTitle')}</h2>
        <p className="text-sm">{t('residencyBody')}</p>
        {residency ? (
          <p className="text-sm" data-testid="residency-current">
            <span className="text-muted-foreground">{t('currentMode')}</span>{' '}
            <strong>{t(`modes.${residency}.name`)}</strong>
            <span className="block text-muted-foreground">{t(`modes.${residency}.text`)}</span>
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">{t('ownerOnly')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          <Link href="/i18n/translation" className="underline">
            {t('translationSettings')}
          </Link>
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t('retentionTitle')}</h2>
        <p className="text-sm">{t('retentionBody', { app })}</p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t('erasureTitle')}</h2>
        <p className="text-sm">{t('erasureBody', { app })}</p>
      </section>
    </div>
  );
}
