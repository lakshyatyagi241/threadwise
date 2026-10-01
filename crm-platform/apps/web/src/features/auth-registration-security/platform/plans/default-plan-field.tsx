'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Field, Select } from '@crm/ui';
import { activePlanOptions } from '../lib/plan-display';
import { PLANS_QUERY_KEY, fetchPlans } from './plans-query';

/**
 * The registration policy's "default plan" (TW-PLAN-008): a dropdown of the
 * ACTIVE plans plus "Automatic" (empty: the plan marked as signup default, else
 * the first active free plan). A stored slug that is no longer an active plan
 * stays selectable as "not an active plan" so saving does not silently change it.
 */
export function DefaultPlanField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (slug: string) => void;
  error?: string;
  disabled: boolean;
}) {
  const t = useTranslations(
    'auth-registration-security.platform.registration.fields.defaultPlanId',
  );
  const q = useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlans(signal),
    refetchOnWindowFocus: false,
  });
  const options = q.data ? activePlanOptions(q.data.data) : [];
  const stale = value !== '' && q.data !== undefined && !options.some((o) => o.slug === value);

  return (
    <Field
      label={t('label')}
      htmlFor="reg-defaultPlanId"
      hint={q.isError ? t('loadFailed') : t('hint')}
      error={error}
    >
      <Select
        id="reg-defaultPlanId"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        invalid={Boolean(error)}
      >
        <option value="">{t('auto')}</option>
        {stale && <option value={value}>{t('unavailable', { slug: value })}</option>}
        {/* The stored slug stays selectable while the list loads or cannot load. */}
        {value !== '' && !q.data && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name} ({t(`kinds.${o.kind}`)})
          </option>
        ))}
      </Select>
    </Field>
  );
}
