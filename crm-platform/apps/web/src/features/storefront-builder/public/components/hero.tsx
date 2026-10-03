import type { PublicShop } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { sanitizeHtml } from '../lib/sanitize';
import { CheckIcon } from './icons';

/**
 * The hero heading is the merchant's text. It arrives already sanitised by the API (D-05) and is rendered through the inline
 * allow-list again (Meridian's italic emphasis needs `em`); an empty text falls back to "Welcome to <shop>.".
 */
export function Hero({ shop }: { shop: PublicShop }) {
  const t = useTranslations('shopPublic');
  const heading = sanitizeHtml(shop.heroText, 'inline').trim();
  return (
    <section className="sf-hero" aria-labelledby="sf-hero-title">
      {heading ? (
        <h1 id="sf-hero-title" dangerouslySetInnerHTML={{ __html: heading }} />
      ) : (
        <h1 id="sf-hero-title">{t('hero.welcome', { shop: shop.name })}</h1>
      )}
      <p>{shop.heroSub ?? t('hero.sub')}</p>
      <div className="sf-hero-trust">
        {(['cod', 'chat', 'returns'] as const).map((k) => (
          <span key={k}>
            <CheckIcon size={14} />
            {t(`hero.trust.${k}`)}
          </span>
        ))}
      </div>
    </section>
  );
}
