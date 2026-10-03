import { useTranslations } from 'next-intl';
import '@/features/storefront-builder/public/styles/storefront.css';

/** Unknown or disabled shop, product or order (TW-STORE-009, 010, 017): one 404 that does not say which. */
export default function ShopNotFound() {
  const t = useTranslations('shopPublic');
  return (
    <div className="sf-order">
      <main className="sf-order-missing">
        <div>
          <h1>{t('notFound.title')}</h1>
          <p className="sf-ot-muted">{t('notFound.body')}</p>
        </div>
      </main>
    </div>
  );
}
