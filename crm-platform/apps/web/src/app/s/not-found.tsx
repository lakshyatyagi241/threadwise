import { getTranslations } from 'next-intl/server';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import '@/features/storefront-builder/public/styles/storefront.css';

export async function generateMetadata() {
  const [site, t] = await Promise.all([getSiteConfig(), getTranslations('shopPublic.notFound')]);
  return {
    title: { absolute: `${t('metaTitle')} — ${site?.brand.name || 'WaDesk'}` },
    robots: null,
  };
}

/**
 * Unknown or disabled shop, product or order (WD-STORE-009, 010, 017): one 404 that does not say which. WaDesk answers with its
 * platform-wide "Page not found" screen (not a shop-specific one), so this is that screen: brand name from the platform
 * settings, "Go back" to the site root, "Sign in" to the staff login.
 */
export default async function ShopNotFound() {
  const t = await getTranslations('shopPublic.notFound');
  const site = await getSiteConfig();
  const brand = site?.brand.name || 'WaDesk';
  return (
    <main className="sf-404">
      <div className="sf-404-card">
        <a href="/" className="sf-404-brand">
          <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
            <rect width="36" height="36" rx="9" fill="#0b1f1c" />
          </svg>
          <span>{brand}</span>
        </a>
        <div className="sf-404-kicker">{t('kicker')}</div>
        <div className="sf-404-code">404</div>
        <h1>{t('title')}</h1>
        <p>{t('body')}</p>
        <div className="sf-404-actions">
          <a href="/" className="sf-404-back">
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
            {t('back')}
          </a>
          <a href="/login" className="sf-404-signin">
            {t('signIn')}
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </a>
        </div>
        <div className="sf-404-help">
          {t('help')} <a href="/support">{t('support')}</a>
        </div>
      </div>
    </main>
  );
}
