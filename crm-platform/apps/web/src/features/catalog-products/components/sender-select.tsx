'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Select, type SelectProps } from '@crm/ui';
import type { CatalogSender } from '@crm/contracts';
import { senderGroups, senderPhone } from '../lib/senders';

/**
 * The unified "Send from" picker (Reference's `x-sender-picker`): with no connected number a coral note and a "Connect one" link;
 * otherwise a dropdown with a first option that lets the server choose, one group per engine when there are several, and the
 * "Connect new device" link. The chosen value is the sender's `engine:id` key.
 */
export function SenderSelect({
  senders,
  value,
  onChange,
  placeholder,
  ...rest
}: {
  senders: CatalogSender[];
  value: string;
  onChange: (key: string) => void;
  /** The text of the empty first option; the picker's own "Select a sender" when not set. */
  placeholder?: string;
} & Omit<SelectProps, 'value' | 'onChange'>) {
  const t = useTranslations('catalogProducts.senderPicker');
  if (senders.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
        {t('none')}
        <Link
          href="/channels"
          className="font-semibold text-brand hover:underline dark:text-primary"
        >
          {t('connectOne')}
        </Link>
      </div>
    );
  }
  const groups = senderGroups(senders);
  const option = (s: CatalogSender) => {
    const phone = senderPhone(s);
    return (
      <option key={s.key} value={s.key}>
        {phone ? `${s.label} · ${phone}` : s.label}
      </option>
    );
  };
  return (
    <>
      <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        <option value="">{placeholder ?? t('select')}</option>
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g.engine} label={t(`engine.${g.engine}`)}>
                {g.items.map(option)}
              </optgroup>
            ))
          : senders.map(option)}
      </Select>
      <Link
        href="/channels"
        className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand hover:underline dark:text-primary"
      >
        {t('connectNew')}
      </Link>
    </>
  );
}
