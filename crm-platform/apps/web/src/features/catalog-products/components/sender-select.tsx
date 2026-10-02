'use client';

import { Select, type SelectProps } from '@crm/ui';
import type { CatalogSender } from '@crm/contracts';
import { senderPhone } from '../lib/senders';

/** The unified "Send from" picker: one option per connected number or device, posted back as its `engine:id` key. */
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
  /** When set, a first option with an empty value lets the server choose ("Auto (active)"). */
  placeholder?: string;
} & Omit<SelectProps, 'value' | 'onChange'>) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {senders.map((s) => {
        const phone = senderPhone(s);
        return (
          <option key={s.key} value={s.key}>
            {phone ? `${s.label} · ${phone}` : s.label}
          </option>
        );
      })}
    </Select>
  );
}
