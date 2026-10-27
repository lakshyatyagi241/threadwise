'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  SALES_ITEM_DESCRIPTION_MAX,
  SALES_ITEM_KINDS,
  SALES_ITEM_NAME_MAX,
  SALES_ITEM_SKU_MAX,
  SALES_ITEM_UNIT_MAX,
  type SalesItem,
  type SalesItemKind,
} from '@crm/contracts';
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useSalesItemMutations } from '../api/hooks';
import { parsePrice, priceToInput, taxText } from '../lib/money';

type Errors = Partial<Record<'name' | 'sku' | 'price' | 'currency' | 'tax' | 'form', string>>;

/** The currencies offered first; any other three-letter code can be typed. */
const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;

/**
 * "Add" and "Edit" for a product or service. Mount it only while it is open: it starts from `item` (or empty) every time.
 */
export function ItemFormModal({
  item,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  item?: SalesItem;
  defaultCurrency: string;
  onClose: () => void;
  onSaved: (item: SalesItem) => void;
}) {
  const t = useTranslations('products-services.form');
  const { create, update } = useSalesItemMutations();
  const [kind, setKind] = useState<SalesItemKind>(item?.kind ?? 'product');
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [currency, setCurrency] = useState(item?.currency ?? defaultCurrency);
  const [price, setPrice] = useState(item ? priceToInput(item.unitPriceMinor, item.currency) : '');
  const [tax, setTax] = useState(item ? taxText(item.taxRatePercent) : '');
  const [active, setActive] = useState(item?.isActive ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const busy = create.isPending || update.isPending;

  async function submit() {
    const next: Errors = {};
    const code = currency.trim().toUpperCase();
    const minor = price.trim() === '' ? 0 : parsePrice(price, code);
    const taxNumber = tax.trim() === '' ? null : Number(tax.trim().replace(',', '.'));
    if (name.trim() === '') next.name = t('errors.nameRequired');
    if (!/^[A-Z]{3}$/.test(code)) next.currency = t('errors.currencyInvalid');
    if (minor === null) next.price = t('errors.priceInvalid');
    if (taxNumber !== null && (!Number.isFinite(taxNumber) || taxNumber < 0 || taxNumber > 100))
      next.tax = t('errors.taxInvalid');
    setErrors(next);
    if (Object.keys(next).length > 0 || minor === null) return;
    const body = {
      kind,
      name,
      sku,
      description,
      unit,
      currency: code,
      unitPriceMinor: minor,
      taxRatePercent: taxNumber,
      isActive: active,
    };
    try {
      const saved = item
        ? await update.mutateAsync({ id: item.id, input: { ...body, rowVersion: item.rowVersion } })
        : await create.mutateAsync(body);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PRD_SKU_TAKEN')
        setErrors({ sku: t('errors.skuTaken') });
      else if (e instanceof ApiError && e.code === 'CONFLICT')
        setErrors({ form: t('errors.changedMeanwhile') });
      else setErrors({ form: e instanceof ApiError ? e.message : t('errors.failed') });
    }
  }

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      title={item ? t('editTitle') : t('addTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {item ? t('save') : t('add')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.form && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errors.form}
          </p>
        )}
        <Field label={t('kind')} htmlFor="item-kind">
          <Select
            id="item-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as SalesItemKind)}
          >
            {SALES_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sku')} htmlFor="item-sku" hint={t('skuHint')} error={errors.sku}>
          <Input
            id="item-sku"
            value={sku}
            maxLength={SALES_ITEM_SKU_MAX}
            invalid={!!errors.sku}
            onChange={(e) => setSku(e.target.value)}
          />
        </Field>
        <Field label={t('name')} htmlFor="item-name" error={errors.name} className="sm:col-span-2">
          <Input
            id="item-name"
            autoFocus
            value={name}
            maxLength={SALES_ITEM_NAME_MAX}
            invalid={!!errors.name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('currency')} htmlFor="item-currency" error={errors.currency}>
          <Input
            id="item-currency"
            list="item-currencies"
            value={currency}
            maxLength={3}
            invalid={!!errors.currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
          <datalist id="item-currencies">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label={t('price')} htmlFor="item-price" error={errors.price}>
          <Input
            id="item-price"
            inputMode="decimal"
            value={price}
            placeholder="0.00"
            invalid={!!errors.price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label={t('unit')} htmlFor="item-unit" hint={t('unitHint')}>
          <Input
            id="item-unit"
            value={unit}
            maxLength={SALES_ITEM_UNIT_MAX}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>
        <Field label={t('tax')} htmlFor="item-tax" hint={t('taxHint')} error={errors.tax}>
          <Input
            id="item-tax"
            inputMode="decimal"
            value={tax}
            invalid={!!errors.tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
        <Field label={t('description')} htmlFor="item-description" className="sm:col-span-2">
          <Textarea
            id="item-description"
            rows={3}
            value={description}
            maxLength={SALES_ITEM_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('active')}
        </label>
      </form>
    </Modal>
  );
}
