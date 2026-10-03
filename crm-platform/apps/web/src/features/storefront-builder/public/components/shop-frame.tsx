import type { PublicProduct, PublicShop } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { resolveTheme } from '../lib/themes';
import '../styles/storefront.css';
import { Footer } from './footer';
import { Header } from './header';
import { Overlays } from './overlays';
import { StoreProvider } from './store-provider';

/**
 * The page shell every themed shop page shares: the theme's tokens as CSS variables on one root element (so nothing reaches
 * outside it), the utility strip, the header, the content, the footer and the overlays.
 */
export function ShopFrame({
  shop,
  products,
  page,
  children,
}: {
  shop: PublicShop;
  /** Products the page already knows (the cart, quick view, wishlist and compare resolve ids through them). */
  products: readonly PublicProduct[];
  /** Which page this is: WaDesk's per-theme styles mostly apply to the home page only. */
  page: 'home' | 'product';
  children: ReactNode;
}) {
  const t = useTranslations('shopPublic');
  const theme = resolveTheme(shop.themeKey, shop.brandColor);
  return (
    <div
      className="sf-root"
      data-sf-theme={theme.key}
      data-sf-page={page}
      style={theme.vars as CSSProperties}
    >
      <StoreProvider shop={shop} products={products}>
        <a href="#sf-main" className="sf-skip">
          {t('common.skip')}
        </a>
        <div className="sf-strip">{shop.topStrip || t('strip')}</div>
        <Header />
        <main id="sf-main">{children}</main>
        <Footer />
        <Overlays />
      </StoreProvider>
    </div>
  );
}
