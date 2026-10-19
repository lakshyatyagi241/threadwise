import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { publicTrustPageSchema, type PublicTrustPage } from '@crm/contracts';
import { apiBase } from '@/lib/auth/server';
import { upstreamFetch } from '@/lib/auth/upstream';

/** The workspace's public page, or null when it is not published (the API answers one 404 for every reason). */
export async function loadTrustPage(slug: string): Promise<PublicTrustPage | null> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(slug)) return null;
  try {
    const res = await upstreamFetch(
      `${apiBase()}/v2/public/compliance/trust/${encodeURIComponent(slug)}`,
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    );
    if (!res.ok) return null;
    const parsed = publicTrustPageSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `/trust/<workspace>`: the sub-processors a workspace chose to publish, with its privacy and terms links and its privacy contact. No
 * login and no app shell. It exists only when the workspace switched it on; a workspace that did not, or does not exist, is a plain 404.
 */
export async function TrustPage({ slug }: { slug: string }) {
  const page = await loadTrustPage(slug);
  if (!page) notFound();
  const t = await getTranslations('compliance-center.trust');
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">{t('title', { workspace: page.workspaceName })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <section aria-labelledby="trust-subs">
        <h2 id="trust-subs" className="text-lg font-semibold">
          {t('subprocessors')}
        </h2>
        {page.subprocessors.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {page.subprocessors.map((s) => (
              <li key={s.name} className="space-y-0.5 p-4">
                <p className="font-medium">
                  {s.websiteUrl ? (
                    <a
                      href={s.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </p>
                {s.purpose && <p className="text-sm">{s.purpose}</p>}
                <p className="text-xs text-muted-foreground">
                  {[s.dataCategories, s.location].filter(Boolean).join(' - ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(page.privacyUrl || page.termsUrl || page.dpoName || page.dpoEmail) && (
        <section aria-labelledby="trust-contact" className="space-y-2 text-sm">
          <h2 id="trust-contact" className="text-lg font-semibold">
            {t('contact')}
          </h2>
          {(page.dpoName || page.dpoEmail) && (
            <p>
              {page.dpoName}
              {page.dpoName && page.dpoEmail ? ' - ' : ''}
              {page.dpoEmail && (
                <a
                  href={`mailto:${page.dpoEmail}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {page.dpoEmail}
                </a>
              )}
            </p>
          )}
          <ul className="flex flex-wrap gap-4">
            {page.privacyUrl && (
              <li>
                <a
                  href={page.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {t('privacy')}
                </a>
              </li>
            )}
            {page.termsUrl && (
              <li>
                <a
                  href={page.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {t('terms')}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
