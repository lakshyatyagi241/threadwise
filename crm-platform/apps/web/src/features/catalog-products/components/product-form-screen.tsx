'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useProduct } from '../api/products';
import { LoadError, LoadingBlock } from './parts';
import { ProductForm } from './product-form';

const CRUMB = 'font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground';

/** `/store/products/create` and `/store/products/:id/edit` (TW-CAT-020): the title and breadcrumb around the shared form. */
export function ProductFormScreen({ id }: { id?: string }) {
  const t = useTranslations('catalogProducts.form');
  const can = useCan(id ? 'cat.products.update' : 'cat.products.create');
  const product = useProduct(id ?? null);
  const [reloads, setReloads] = useState(0);

  const frame = (title: string, body: React.ReactNode) => (
    <div className="mx-auto min-h-full max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <section className="min-w-0 space-y-5">
        <nav aria-label={t('breadcrumb')} className={CRUMB}>
          <Link href="/store/products" className="hover:text-brand">
            {t('products')}
          </Link>{' '}
          / {id ? t('crumbEdit') : t('crumbNew')}
        </nav>
        <h1 className="break-words font-serif text-[26px] font-normal leading-tight tracking-tight sm:text-[34px]">
          {title}
        </h1>
        {body}
      </section>
    </div>
  );

  if (!can) {
    return frame(
      id ? t('editFallback') : t('addTitle'),
      <EmptyState title={t('noPermissionTitle')} message={t('noPermission')} />,
    );
  }
  if (!id) return frame(t('addTitle'), <ProductForm />);

  if (product.isPending) return frame(t('editFallback'), <LoadingBlock label={t('loading')} />);
  if (product.isError || !product.data) {
    return frame(
      t('editFallback'),
      <LoadError
        error={product.error}
        title={t('loadError')}
        onRetry={() => void product.refetch()}
      />,
    );
  }
  const data = product.data;
  return frame(
    data.name,
    <ProductForm
      key={`${data.id}-${data.rowVersion}-${reloads}`}
      product={data}
      onReload={() => {
        void product.refetch().then(() => setReloads((n) => n + 1));
      }}
    />,
  );
}
