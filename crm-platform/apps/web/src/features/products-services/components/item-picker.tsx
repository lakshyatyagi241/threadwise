'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@crm/ui';
import { useOptionalSession } from '@/features/auth-registration-security/shared/session-context';
import { usePlanFeature } from '@/lib/plan-features';
import { useSalesItems } from '../api/hooks';
import { formatPrice, priceToInput, taxText } from '../lib/money';

/** What a picked product or service fills into a document line. Free text stays free: every field is just a starting value. */
export interface PickedItem {
  name: string;
  sku: string;
  /** Unit price as typed in a price box (major units), or '' when the item is priced in another currency than the document. */
  price: string;
  /** Default tax percent as text ("18"), or '' for none. */
  taxPercent: string;
}

interface ItemPickerProps {
  /** ISO code of the document. An item in another currency is listed but cannot be picked. */
  currency: string;
  locale: string;
  disabled?: boolean;
  onPick: (item: PickedItem) => void;
}

/**
 * "Pick from your price list" above a document line. It shows only when the Products and services add-on is on in the plan and the
 * person may read it, and says nothing when the list is empty or cannot be loaded, so a document line is always plain free text first.
 */
export function ItemPicker(props: ItemPickerProps) {
  const planOn = usePlanFeature('products_services');
  const session = useOptionalSession();
  const canRead = !!session && 'record.sales-items.read' in session.permissions;
  // The list is asked for only past this gate, so a screen without a session or a query client (a test, a story) is untouched.
  return planOn && canRead ? <PickerList {...props} /> : null;
}

function PickerList({ currency, locale, disabled, onPick }: ItemPickerProps) {
  const t = useTranslations('products-services.picker');
  const list = useSalesItems({ status: 'active', limit: 200 });
  const items = list.data?.data ?? [];
  if (list.isError || items.length === 0) return null;
  return (
    <Select
      aria-label={t('label')}
      disabled={disabled}
      value=""
      onChange={(e) => {
        const item = items.find((i) => i.id === e.target.value);
        if (!item) return;
        onPick({
          name: item.name,
          sku: item.sku ?? '',
          price:
            item.currency === currency.toUpperCase()
              ? priceToInput(item.unitPriceMinor, item.currency)
              : '',
          taxPercent: taxText(item.taxRatePercent),
        });
      }}
    >
      <option value="">{t('placeholder')}</option>
      {items.map((i) => {
        const same = i.currency === currency.toUpperCase();
        return (
          <option key={i.id} value={i.id} disabled={!same}>
            {i.name} - {formatPrice(i.unitPriceMinor, i.currency, locale)}
            {same ? '' : ` (${t('otherCurrency')})`}
          </option>
        );
      })}
    </Select>
  );
}
