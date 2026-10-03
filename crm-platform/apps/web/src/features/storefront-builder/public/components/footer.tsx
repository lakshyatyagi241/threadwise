'use client';

import { useTranslations } from 'next-intl';
import { waChatUrl, shopPath } from '../lib/links';
import { footerParts } from '../lib/footer';
import { useStore, type ModalSpec } from './store-provider';

const TOPICS: ReadonlyArray<Extract<ModalSpec, { kind: 'info' }>['topic']> = [
  'shipping',
  'returns',
  'howToOrder',
  'privacy',
];

export function Footer() {
  const t = useTranslations('shopPublic');
  const { shop, toggleDrawer, openModal, flash } = useStore();
  const home = shopPath(shop.slug);
  const { custom, bottom } = footerParts(shop);
  const digits = shop.waNumber?.replace(/\D+/g, '') ?? '';

  return (
    <footer className="sf-foot" id="about">
      <div className="sf-foot-grid">
        <div className="sf-foot-col">
          <div className="sf-foot-brand">{shop.name}</div>
          {custom ? (
            <p className="sf-foot-blurb" dangerouslySetInnerHTML={{ __html: custom }} />
          ) : (
            <p className="sf-foot-blurb">{t('footer.blurb')}</p>
          )}
          <div className="sf-foot-pay" aria-label={t('footer.paymentsLabel')}>
            <span>{t('footer.pay.whatsapp')}</span>
            <span>{t('footer.pay.upi')}</span>
            <span>{t('footer.pay.cod')}</span>
            <span>{t('footer.pay.bank')}</span>
          </div>
        </div>
        <div className="sf-foot-col">
          <h4>{t('footer.shopHeading')}</h4>
          <a href={home}>{t('footer.allProducts')}</a>
          <a href={`${home}#categories`}>{t('header.categories')}</a>
          <button type="button" onClick={() => toggleDrawer('wish')}>
            {t('header.wishlist')}
          </button>
          <button type="button" onClick={() => toggleDrawer('compare')}>
            {t('header.compare')}
          </button>
        </div>
        <div className="sf-foot-col">
          <h4>{t('footer.helpHeading')}</h4>
          {TOPICS.map((topic) => (
            <button key={topic} type="button" onClick={() => openModal({ kind: 'info', topic })}>
              {t(`footer.help.${topic}`)}
            </button>
          ))}
        </div>
        <div className="sf-foot-col">
          <h4>{t('footer.contactHeading')}</h4>
          {digits ? (
            <a href={waChatUrl(digits)} target="_blank" rel="noopener noreferrer">
              {t('footer.whatsappLink', { number: digits })}
            </a>
          ) : null}
          <button type="button" onClick={() => flash(t('footer.hoursToast'))}>
            {t('footer.hours')}
          </button>
        </div>
      </div>
      <div className="sf-foot-bottom">
        {bottom ? (
          <span dangerouslySetInnerHTML={{ __html: bottom }} />
        ) : (
          <span>{t('footer.copyright', { year: new Date().getFullYear(), shop: shop.name })}</span>
        )}
      </div>
    </footer>
  );
}
