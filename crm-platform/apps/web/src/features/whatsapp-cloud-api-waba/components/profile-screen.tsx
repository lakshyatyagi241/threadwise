'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, EmptyState, Field, Select, Spinner } from '@crm/ui';
import { useNumbers } from '../api/hooks';
import { BusinessProfileCard } from './business-profile-card';
import { ComplianceCard } from './compliance-card';
import { useErrorText } from './use-error-text';

/**
 * Settings > Business and billing > WhatsApp business profile: the profile and the compliance form of one number. The number
 * is picked from the connected ones; the primary number comes first and is the one shown until another is picked.
 */
export function WhatsappProfileScreen() {
  const t = useTranslations('whatsapp-cloud-api-waba.profile');
  const errorText = useErrorText();
  const numbers = useNumbers();
  const [picked, setPicked] = useState<string | null>(null);

  if (numbers.isPending) return <Spinner label={t('loading')} />;
  if (numbers.isError) return <Alert tone="warning">{errorText(numbers.error).text}</Alert>;

  const list = [...numbers.data.items].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  if (list.length === 0) return <EmptyState title={t('numberNone')} />;

  const current = list.find((n) => n.id === picked) ?? list[0]!;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{t('pageTitle')}</h2>
      <Field label={t('numberLabel')} htmlFor="wp-number" className="max-w-sm">
        <Select id="wp-number" value={current.id} onChange={(e) => setPicked(e.target.value)}>
          {list.map((n) => (
            <option key={n.id} value={n.id}>
              {n.displayLabel || n.phoneNumber}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <BusinessProfileCard key={current.id} id={current.id} />
        <ComplianceCard key={current.id} id={current.id} />
      </div>
    </div>
  );
}
