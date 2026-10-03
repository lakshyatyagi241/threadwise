'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import {
  PRODUCT_BODY_HTML_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_GALLERY_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SKU_MAX,
  type ProductResponse,
} from '@crm/contracts';
import { KEYS } from '../api/catalog';
import { createProduct, updateProduct } from '../api/products';
import { errorKind, fieldErrors, isRowVersionConflict } from '../lib/errors';
import {
  CATEGORY_SUGGESTIONS,
  CURRENCY_OPTIONS,
  EMPTY_PRODUCT_FORM,
  STATUS_OPTIONS,
  buildInput,
  fieldOfPath,
  focusFirstInvalid,
  formFromProduct,
  previewCompare,
  previewPrice,
  profitIndicator,
  validate,
  type FieldKey,
  type ProductForm as Form,
} from '../lib/product-form';
import { CloseIcon, ImageIcon, PlusIcon } from './icons';
import { CARD, ErrorLine, KICKER, ProductThumb } from './parts';
import { useErrorText } from './use-error-text';

const SECTION = `${CARD} p-5`;
const LABEL = 'font-semibold';
const MONO = 'font-mono text-[13px]';

/**
 * The shared form of `/store/products/create` and `/store/products/:id/edit` (TW-CAT-020): basics, media (image URL and
 * gallery URLs), pricing with the profit indicator, inventory and shipping, visibility, organization and a live storefront
 * preview. Uploading an image file waits on the storage domain; the primary image and the gallery take URLs.
 */
export function ProductForm({
  product,
  onReload,
}: {
  /** Absent when creating. */
  product?: ProductResponse;
  /** Shown with a row-version conflict: re-read the product and reset the form. */
  onReload?: () => void;
}) {
  const t = useTranslations('catalogProducts.form');
  const errorText = useErrorText();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() =>
    product ? formFromProduct(product) : EMPTY_PRODUCT_FORM,
  );
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const problems = validate(form);
  const server: Partial<Record<FieldKey, string>> = {};
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    const key = fieldOfPath(path);
    if (key && !(key in server)) server[key] = message;
  }
  const fieldError = (k: FieldKey): string | undefined => {
    const p = picked ? problems[k] : undefined;
    return p ? t(`problem.${p}`) : server[k];
  };
  const conflict = error !== null && isRowVersionConflict(error);
  const hasFieldErrors =
    (picked && Object.keys(problems).length > 0) || Object.keys(server).length > 0;
  const profit = profitIndicator(form.priceMajor, form.comparePriceMajor);
  const compare = previewCompare(form);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPicked(true);
    setError(null);
    if (Object.keys(problems).length > 0) {
      focusFirstInvalid(Object.keys(problems) as FieldKey[]);
      return;
    }
    setBusy(true);
    try {
      const input = buildInput(form);
      if (product) await updateProduct(product.id, { ...input, rowVersion: product.rowVersion });
      else await createProduct(input);
      toast(product ? t('updated') : t('created'), 'success');
      void qc.invalidateQueries({ queryKey: KEYS.products });
      void qc.invalidateQueries({ queryKey: KEYS.overview });
      if (product) void qc.invalidateQueries({ queryKey: KEYS.product(product.id) });
      router.push('/store/products');
    } catch (err) {
      setError(err);
      setBusy(false);
      const keys = Object.keys(fieldErrors(err))
        .map(fieldOfPath)
        .filter((k): k is FieldKey => k !== null);
      if (keys.length > 0) focusFirstInvalid(keys);
    }
  };

  const setGallery = (i: number, value: string) =>
    patch({ galleryUrls: form.galleryUrls.map((u, j) => (j === i ? value : u)) });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
      {conflict ? (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{errorText(error)}</span>
          {onReload && (
            <Button size="sm" variant="secondary" onClick={onReload}>
              {t('reload')}
            </Button>
          )}
        </Alert>
      ) : error && errorKind(error) !== 'validation' ? (
        <ErrorLine>{errorText(error)}</ErrorLine>
      ) : hasFieldErrors ? (
        <ErrorLine>{t('fixFields')}</ErrorLine>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <section className={SECTION} aria-labelledby="cat-form-basics">
            <h2 id="cat-form-basics" className={`${KICKER} mb-3 font-normal`}>
              {t('basics')}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field
                className="md:col-span-2"
                label={
                  <span className={LABEL}>
                    {t('name')} <span className="text-danger">*</span>
                  </span>
                }
                htmlFor="cat-p-name"
                error={fieldError('name')}
              >
                <Input
                  id="cat-p-name"
                  value={form.name}
                  maxLength={PRODUCT_NAME_MAX}
                  placeholder={t('namePlaceholder')}
                  invalid={Boolean(fieldError('name'))}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field
                label={
                  <span className={LABEL}>
                    {t('sku')}{' '}
                    <span className="font-normal text-muted-foreground">{t('optional')}</span>
                  </span>
                }
                htmlFor="cat-p-sku"
                error={fieldError('sku')}
              >
                <Input
                  id="cat-p-sku"
                  value={form.sku}
                  maxLength={PRODUCT_SKU_MAX}
                  placeholder="ST-001"
                  className="font-mono"
                  onChange={(e) => patch({ sku: e.target.value })}
                />
              </Field>
            </div>
            <Field
              className="mt-4"
              label={<span className={LABEL}>{t('shortDescription')}</span>}
              htmlFor="cat-p-description"
              error={fieldError('description')}
            >
              <Textarea
                id="cat-p-description"
                rows={2}
                value={form.description}
                maxLength={PRODUCT_DESCRIPTION_MAX}
                placeholder={t('shortDescriptionPlaceholder')}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <Field
              className="mt-4"
              label={
                <span className={LABEL}>
                  {t('fullDescription')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('fullDescriptionNote')}
                  </span>
                </span>
              }
              htmlFor="cat-p-body"
              error={fieldError('bodyHtml')}
            >
              <Textarea
                id="cat-p-body"
                rows={6}
                value={form.bodyHtml}
                maxLength={PRODUCT_BODY_HTML_MAX}
                placeholder={t('fullDescriptionPlaceholder')}
                onChange={(e) => patch({ bodyHtml: e.target.value })}
              />
            </Field>
          </section>

          <section className={SECTION} aria-labelledby="cat-form-media">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="cat-form-media" className={`${KICKER} font-normal`}>
                {t('media')}
              </h2>
              <span className="text-[10.5px] text-muted-foreground">{t('primaryImage')}</span>
            </div>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[200px_1fr]">
              <div className="mx-auto aspect-square w-full max-w-[200px] overflow-hidden rounded-xl border border-border bg-muted">
                <ProductThumb
                  key={form.imageUrl.trim()}
                  url={form.imageUrl.trim() || null}
                  glyph="image"
                  size="size-full"
                  className="rounded-none"
                />
              </div>
              <div className="space-y-3">
                <Field
                  label={<span className={LABEL}>{t('imageUrl')}</span>}
                  htmlFor="cat-p-image"
                  hint={t('imageUrlHint')}
                  error={fieldError('imageUrl')}
                >
                  <Input
                    id="cat-p-image"
                    type="url"
                    value={form.imageUrl}
                    maxLength={1024}
                    placeholder="https://..."
                    invalid={Boolean(fieldError('imageUrl'))}
                    className="font-mono text-[12.5px]"
                    onChange={(e) => patch({ imageUrl: e.target.value })}
                  />
                </Field>
                <div className="rounded-lg border border-border bg-muted/50 p-3 text-[11.5px]">
                  <div className="mb-0.5 font-semibold">{t('photoTipsTitle')}</div>
                  {t('photoTips')}
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className={`${KICKER} font-normal`}>{t('gallery')}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t('galleryHint')}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full text-[11.5px]"
                  disabled={form.galleryUrls.length >= PRODUCT_GALLERY_MAX}
                  onClick={() => patch({ galleryUrls: [...form.galleryUrls, ''] })}
                >
                  <PlusIcon className="size-3" strokeWidth={1.8} />
                  {t('addGalleryUrl')}
                </Button>
              </div>
              <ul className="space-y-2">
                {form.galleryUrls.map((url, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <ProductThumb
                      key={url.trim()}
                      url={url.trim() || null}
                      glyph="image"
                      size="size-12"
                      className="border border-border"
                    />
                    <Input
                      type="url"
                      value={url}
                      maxLength={1024}
                      placeholder="https://..."
                      aria-label={t('galleryRow', { n: i + 1 })}
                      autoFocus={url === '' && i === form.galleryUrls.length - 1}
                      className="font-mono text-[12px]"
                      onChange={(e) => setGallery(i, e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={t('removeGallery', { n: i + 1 })}
                      onClick={() =>
                        patch({ galleryUrls: form.galleryUrls.filter((_, j) => j !== i) })
                      }
                      className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground outline-none hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <CloseIcon className="size-3" strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
              {form.galleryUrls.length === 0 && (
                <p className="text-[11.5px] italic text-muted-foreground">{t('galleryEmpty')}</p>
              )}
              {fieldError('gallery') && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {fieldError('gallery')}
                </p>
              )}
            </div>
          </section>

          <section className={SECTION} aria-labelledby="cat-form-pricing">
            <h2 id="cat-form-pricing" className={`${KICKER} mb-3 font-normal`}>
              {t('pricing')}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field
                label={
                  <span className={LABEL}>
                    {t('price')} <span className="text-danger">*</span>
                  </span>
                }
                htmlFor="cat-p-price"
                error={fieldError('priceMajor')}
              >
                <Input
                  id="cat-p-price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.priceMajor}
                  invalid={Boolean(fieldError('priceMajor'))}
                  className={MONO}
                  onChange={(e) => patch({ priceMajor: e.target.value })}
                />
              </Field>
              <Field
                label={
                  <span className={LABEL}>
                    {t('comparePrice')}{' '}
                    <span className="font-normal text-muted-foreground">{t('was')}</span>
                  </span>
                }
                htmlFor="cat-p-compare"
                hint={t('comparePriceHint')}
                error={fieldError('comparePriceMajor')}
              >
                <Input
                  id="cat-p-compare"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.comparePriceMajor}
                  placeholder="0.00"
                  invalid={Boolean(fieldError('comparePriceMajor'))}
                  className={MONO}
                  onChange={(e) => patch({ comparePriceMajor: e.target.value })}
                />
              </Field>
              <Field
                label={<span className={LABEL}>{t('currency')}</span>}
                htmlFor="cat-p-currency"
              >
                <Select
                  id="cat-p-currency"
                  value={form.currencyCode}
                  onChange={(e) => patch({ currencyCode: e.target.value })}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={<span className={LABEL}>{t('profit')}</span>}
                htmlFor="cat-p-profit"
                hint={t('profitHint')}
              >
                <output
                  id="cat-p-profit"
                  data-testid="profit-indicator"
                  className={cn(
                    'block rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[13px]',
                    profit.kind === 'off' && 'text-success',
                    profit.kind === 'lower' && 'text-danger',
                  )}
                >
                  {profit.kind === 'none' && '—'}
                  {profit.kind === 'off' && t('profitOff', { percent: profit.percent })}
                  {profit.kind === 'lower' && t('profitLower')}
                  {profit.kind === 'same' && t('profitSame')}
                </output>
              </Field>
            </div>
          </section>

          <section className={SECTION} aria-labelledby="cat-form-inventory">
            <h2 id="cat-form-inventory" className={`${KICKER} mb-3 font-normal`}>
              {t('inventory')}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field
                label={<span className={LABEL}>{t('stockQty')}</span>}
                htmlFor="cat-p-stock"
                error={fieldError('stockQty')}
              >
                <Input
                  id="cat-p-stock"
                  type="number"
                  min={0}
                  max={1000000}
                  value={form.stockQty}
                  placeholder={t('stockPlaceholder')}
                  invalid={Boolean(fieldError('stockQty'))}
                  className={MONO}
                  onChange={(e) => patch({ stockQty: e.target.value })}
                />
              </Field>
              <Field
                label={
                  <span className={LABEL}>
                    {t('weight')} <span className="font-normal text-muted-foreground">(g)</span>
                  </span>
                }
                htmlFor="cat-p-weight"
                hint={t('weightHint')}
                error={fieldError('weightGrams')}
              >
                <Input
                  id="cat-p-weight"
                  type="number"
                  min={0}
                  max={1000000}
                  value={form.weightGrams}
                  placeholder={t('weightPlaceholder')}
                  invalid={Boolean(fieldError('weightGrams'))}
                  className={MONO}
                  onChange={(e) => patch({ weightGrams: e.target.value })}
                />
              </Field>
              <div className="mt-5">
                <Checkbox
                  id="cat-p-instock"
                  checked={form.inStock}
                  onChange={(e) => patch({ inStock: e.target.checked })}
                  label={
                    <span>
                      <span className="block font-semibold">{t('available')}</span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {t('availableHint')}
                      </span>
                    </span>
                  }
                />
              </div>
              <Field
                label={<span className={LABEL}>{t('sortOrder')}</span>}
                htmlFor="cat-p-sort"
                hint={t('sortOrderHint')}
                error={fieldError('sortOrder')}
              >
                <Input
                  id="cat-p-sort"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.sortOrder}
                  invalid={Boolean(fieldError('sortOrder'))}
                  className={MONO}
                  onChange={(e) => patch({ sortOrder: e.target.value })}
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className={cn(CARD, 'p-4')}>
            <h2 className={`${KICKER} mb-2 font-normal`}>{t('visibility')}</h2>
            <Select
              aria-label={t('visibility')}
              value={form.status}
              onChange={(e) => patch({ status: e.target.value as Form['status'] })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </section>

          <section className={cn(CARD, 'p-4')}>
            <h2 className={`${KICKER} mb-2 font-normal`}>{t('organization')}</h2>
            <Field
              className="mb-3"
              label={<span className={LABEL}>{t('category')}</span>}
              htmlFor="cat-p-category"
              error={fieldError('category')}
            >
              <Input
                id="cat-p-category"
                value={form.category}
                maxLength={96}
                list="cat-category-suggestions"
                placeholder={t('categoryPlaceholder')}
                onChange={(e) => patch({ category: e.target.value })}
              />
              <datalist id="cat-category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field
              label={
                <span className={LABEL}>
                  {t('tags')}{' '}
                  <span className="font-normal text-muted-foreground">{t('tagsNote')}</span>
                </span>
              }
              htmlFor="cat-p-tags"
              error={fieldError('tags')}
            >
              <Input
                id="cat-p-tags"
                value={form.tags}
                maxLength={1024}
                placeholder={t('tagsPlaceholder')}
                onChange={(e) => patch({ tags: e.target.value })}
              />
            </Field>
          </section>

          <section className={cn(CARD, 'p-4')} aria-labelledby="cat-form-preview">
            <h2 id="cat-form-preview" className={`${KICKER} mb-2 font-normal`}>
              {t('preview')}
            </h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid aspect-square place-items-center bg-muted">
                {form.imageUrl.trim() ? (
                  <ProductThumb
                    key={form.imageUrl.trim()}
                    url={form.imageUrl.trim()}
                    glyph="image"
                    size="size-full"
                    className="rounded-none"
                  />
                ) : (
                  <span className="inline-flex flex-col items-center gap-1 text-[10.5px] text-muted-foreground">
                    <ImageIcon className="size-5" />
                    {t('noImage')}
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="font-serif text-[15px] leading-tight">
                  {form.name.trim() || t('productName')}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold">{previewPrice(form)}</span>
                  {compare && (
                    <span className="text-[11.5px] text-muted-foreground line-through">
                      {compare}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className={cn(CARD, 'flex items-center justify-end gap-2 p-3')}>
        <Link
          href="/store/products"
          className="inline-flex h-10 items-center rounded-full border border-border px-4 text-[12px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('cancel')}
        </Link>
        <Button
          type="submit"
          variant="brand"
          className="rounded-full px-5 text-[12.5px]"
          disabled={busy}
        >
          {busy && <Spinner />}
          {product ? t('saveChanges') : t('createProduct')}
        </Button>
      </div>
    </form>
  );
}
