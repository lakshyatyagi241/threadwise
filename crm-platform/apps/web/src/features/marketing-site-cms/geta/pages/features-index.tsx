'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PRODUCT_GROUPS, hrefOf, type Product } from '../data/products';
import { Icon } from '../icons';

/** Every capability of every product, filterable by area and searchable, each linking to its product page. */
export function FeaturesIndex({ products }: { products: Product[] }) {
  const [area, setArea] = useState<'all' | Product['group']>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => area === 'all' || p.group === area)
      .flatMap((p) => p.features.map((f) => ({ ...f, product: p })))
      .filter(
        (f) => !needle || `${f.title} ${f.text} ${f.product.name}`.toLowerCase().includes(needle),
      );
  }, [products, area, q]);

  return (
    <>
      <label htmlFor="gx-feature-search" className="sr-only">
        Search features
      </label>
      <input
        id="gx-feature-search"
        className="gx-search"
        type="search"
        placeholder="Search features, e.g. “reminders”"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="gx-filters" role="group" aria-label="Filter by area">
        <button
          type="button"
          className="gx-chip"
          aria-pressed={area === 'all'}
          onClick={() => setArea('all')}
        >
          All
        </button>
        {(Object.keys(PRODUCT_GROUPS) as Array<Product['group']>).map((g) => (
          <button
            key={g}
            type="button"
            className="gx-chip"
            aria-pressed={area === g}
            onClick={() => setArea(g)}
          >
            {PRODUCT_GROUPS[g].label}
          </button>
        ))}
      </div>
      <p aria-live="polite" style={{ fontSize: 14, color: 'var(--gx-mute)', margin: '0 0 16px' }}>
        {rows.length} {rows.length === 1 ? 'feature' : 'features'}
      </p>
      <div className="gx-grid gx-grid-3">
        {rows.map((f) => (
          <Link key={`${f.product.slug}-${f.title}`} href={hrefOf(f.product)} className="gx-card">
            <div className="gx-ic">
              <Icon name={f.icon} />
            </div>
            <h3 className="gx-h3">{f.title}</h3>
            <p>{f.text}</p>
            <div className="gx-tags">
              <span className="gx-tag">{f.product.name}</span>
            </div>
          </Link>
        ))}
      </div>
      {rows.length === 0 && (
        <p style={{ textAlign: 'center', padding: '40px 0' }}>
          Nothing matches “{q}”. Try a broader word, or{' '}
          <Link href="/contact" style={{ color: 'var(--gx-blue)' }}>
            ask us
          </Link>
          .
        </p>
      )}
    </>
  );
}
