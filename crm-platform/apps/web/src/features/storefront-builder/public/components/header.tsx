'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { shopPath } from '../lib/links';
import { CartIcon, CompareIcon, HeartIcon, SearchIcon } from './icons';
import { useStore, type DrawerKind } from './store-provider';

function Badge({ count, bumpKey }: { count: number; bumpKey: number }) {
  if (count === 0) return null;
  return (
    <span key={bumpKey} className={`sf-badge${bumpKey > 0 ? ' is-bump' : ''}`} aria-hidden="true">
      {count}
    </span>
  );
}

export function Header() {
  const t = useTranslations('shopPublic');
  const { shop, cartCount, wish, compare, bumps, toggleDrawer, drawer, search, setSearch } =
    useStore();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const home = shopPath(shop.slug);

  const action = (kind: DrawerKind, label: string, count: number, icon: React.ReactNode) => (
    <button
      type="button"
      className="sf-icon-btn"
      aria-label={count > 0 ? t('header.withCount', { label, count }) : label}
      aria-haspopup="dialog"
      aria-expanded={drawer === kind}
      title={label}
      onClick={() => toggleDrawer(kind)}
    >
      {icon}
      <Badge count={count} bumpKey={bumps[kind]} />
    </button>
  );

  return (
    <header className={`sf-head${stuck ? ' is-stuck' : ''}`}>
      <a href={home} className="sf-brand">
        {shop.logoUrl ? <img src={shop.logoUrl} alt="" /> : null}
        <span>{shop.name}</span>
      </a>
      <nav className="sf-nav" aria-label={t('header.navLabel')}>
        <a href={home}>{t('header.shop')}</a>
        <a href={`${home}#categories`}>{t('header.categories')}</a>
        <a href={`${home}#about`}>{t('header.about')}</a>
      </nav>
      <div className="sf-search">
        <SearchIcon size={14} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('header.searchPlaceholder')}
          aria-label={t('header.searchLabel')}
          autoComplete="off"
        />
      </div>
      <div className="sf-actions">
        {action('wish', t('header.wishlist'), wish.length, <HeartIcon />)}
        {action('compare', t('header.compare'), compare.length, <CompareIcon />)}
        {action('cart', t('header.cart'), cartCount, <CartIcon />)}
      </div>
    </header>
  );
}
