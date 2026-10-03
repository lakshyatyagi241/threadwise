'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { isOnSale } from '../lib/catalog';
import { shareLinks, productPath } from '../lib/links';
import { formatMinor } from '../lib/money';
import { CheckoutForm } from './checkout-form';
import { CartDrawer, CompareBar, CompareDrawer, WishDrawer } from './drawers';
import { CloseIcon, MailIcon, TelegramIcon, UploadIcon, WhatsAppIcon } from './icons';
import { ProductImage } from './product-image';
import { useStore, type ModalSpec } from './store-provider';
import { useDialog } from './use-dialog';

function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('shopPublic');
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(card, true, onClose);
  return (
    <div className="sf-modal" data-open="1">
      <div className="sf-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={card}
        className="sf-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button
          type="button"
          className="sf-modal-close"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <CloseIcon size={16} />
        </button>
        <div className="sf-modal-title" id={titleId}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function QuickView({ productId }: { productId: string }) {
  const t = useTranslations('shopPublic');
  const { shop, catalog, addToCart, closeModal } = useStore();
  const p = catalog[productId];
  if (!p) return null;
  return (
    <ModalFrame title={p.name} onClose={closeModal}>
      <div className="sf-qv">
        <div className="sf-qv-img">
          <ProductImage src={p.imageUrl} alt={p.name} />
        </div>
        <div className="sf-qv-meta">
          <div className="sf-qv-price">
            <span className="sf-qv-now">{p.priceDisplay}</span>
            {isOnSale(p) && p.comparePriceDisplay ? (
              <s className="sf-qv-was">{p.comparePriceDisplay}</s>
            ) : null}
          </div>
          {p.description ? <p className="sf-qv-desc">{p.description}</p> : null}
          <div className="sf-qv-actions">
            <button
              type="button"
              className="sf-cta"
              onClick={() => {
                addToCart(p);
                closeModal();
              }}
            >
              {t('card.addToCart')}
            </button>
            <a className="sf-cta-ghost" href={productPath(shop.slug, p.slug)}>
              {t('quick.details')}
            </a>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

function ShareDialog({ url, title }: { url: string; title: string }) {
  const t = useTranslations('shopPublic');
  const { closeModal, flash } = useStore();
  const [copied, setCopied] = useState(false);
  const links = shareLinks(url, title);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      flash(t('share.copyFailed'));
    }
  };
  const native = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: links.text, url });
      } catch {
        /* the buyer dismissed the sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash(t('share.linkCopied'));
    } catch {
      flash(t('share.copyFailed'));
    }
  };

  return (
    <ModalFrame title={t('share.title')} onClose={closeModal}>
      <div className="sf-share-url">
        <input
          value={url}
          readOnly
          aria-label={t('share.url')}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="sf-cta" onClick={() => void copy()}>
          {copied ? t('share.copied') : t('share.copy')}
        </button>
      </div>
      <div className="sf-share-grid">
        <a href={links.whatsapp} target="_blank" rel="noopener noreferrer">
          <span className="sf-share-ico is-wa">
            <WhatsAppIcon size={16} />
          </span>
          <span>
            <b>{t('share.whatsapp')}</b>
            <small>{t('share.whatsappHint')}</small>
          </span>
        </a>
        <a href={links.mailto}>
          <span className="sf-share-ico">
            <MailIcon size={14} />
          </span>
          <span>
            <b>{t('share.email')}</b>
            <small>{t('share.emailHint')}</small>
          </span>
        </a>
        <a href={links.telegram} target="_blank" rel="noopener noreferrer">
          <span className="sf-share-ico is-tg">
            <TelegramIcon size={14} />
          </span>
          <span>
            <b>{t('share.telegram')}</b>
            <small>{t('share.telegramHint')}</small>
          </span>
        </a>
        <button type="button" onClick={() => void native()}>
          <span className="sf-share-ico">
            <UploadIcon size={14} />
          </span>
          <span>
            <b>{t('share.more')}</b>
            <small>{t('share.moreHint')}</small>
          </span>
        </button>
      </div>
      <details className="sf-qr">
        <summary>{t('share.showQr')}</summary>
        <div className="sf-qr-box">
          {/* Generated here: the address of the page is never sent to a third-party image service. */}
          <QRCodeSVG
            value={url}
            size={180}
            marginSize={2}
            bgColor="#FFFFFF"
            fgColor="#000000"
            title={t('share.qrTitle')}
          />
          <div>{t('share.scan')}</div>
        </div>
      </details>
    </ModalFrame>
  );
}

function Placed({ spec }: { spec: Extract<ModalSpec, { kind: 'placed' }> }) {
  const t = useTranslations('shopPublic');
  const { closeModal } = useStore();
  return (
    <ModalFrame title={t('placed.title', { orderNo: spec.orderNo })} onClose={closeModal}>
      <div className="sf-modal-body">
        <p>{spec.message}</p>
        <div className="sf-placed-links">
          {spec.trackUrl ? (
            <a className="sf-cta-ghost" href={spec.trackUrl}>
              {t('placed.track', { orderNo: spec.orderNo })}
            </a>
          ) : null}
          {spec.waUrl ? (
            <a className="sf-cta-ghost" href={spec.waUrl} target="_blank" rel="noopener noreferrer">
              {t('placed.openWhatsApp')}
            </a>
          ) : null}
        </div>
      </div>
      <div className="sf-modal-actions">
        <button type="button" className="sf-cta" onClick={closeModal}>
          {t('common.done')}
        </button>
      </div>
    </ModalFrame>
  );
}

function InfoBody({ topic }: { topic: Extract<ModalSpec, { kind: 'info' }>['topic'] }) {
  const t = useTranslations('shopPublic');
  const { shop } = useStore();
  const free = shop.shipping.freeAboveMinor;
  const extra =
    topic === 'shipping' && free > 0
      ? ` ${t('info.freeAbove', { amount: formatMinor(free, shop.currencyCode) })}`
      : '';
  return <>{t(`info.${topic}.body`) + extra}</>;
}

function ModalHost() {
  const t = useTranslations('shopPublic');
  const { modal, closeModal } = useStore();
  if (!modal) return null;
  switch (modal.kind) {
    case 'message':
    case 'info': {
      const title = modal.kind === 'message' ? modal.title : t(`info.${modal.topic}.title`);
      return (
        <ModalFrame key={`${modal.kind}-${title}`} title={title} onClose={closeModal}>
          <div className="sf-modal-body">
            {modal.kind === 'message' ? modal.body : <InfoBody topic={modal.topic} />}
          </div>
          <div className="sf-modal-actions">
            <button type="button" className="sf-cta" onClick={closeModal}>
              {t('common.ok')}
            </button>
          </div>
        </ModalFrame>
      );
    }
    case 'quick':
      return <QuickView key={modal.productId} productId={modal.productId} />;
    case 'share':
      return <ShareDialog key={modal.url} url={modal.url} title={modal.title} />;
    case 'placed':
      return <Placed key="placed" spec={modal} />;
    case 'checkout':
      return (
        <ModalFrame key="checkout" title={t('checkout.title')} onClose={closeModal}>
          <CheckoutForm />
        </ModalFrame>
      );
  }
}

/** Everything that floats above the page: drawers, the compare bar, the modal and the toast. */
export function Overlays() {
  const { toastMessage } = useStore();
  return (
    <>
      <CompareBar />
      <CartDrawer />
      <WishDrawer />
      <CompareDrawer />
      <ModalHost />
      <div className={`sf-toast${toastMessage ? ' show' : ''}`} role="status" aria-live="polite">
        {toastMessage}
      </div>
    </>
  );
}
