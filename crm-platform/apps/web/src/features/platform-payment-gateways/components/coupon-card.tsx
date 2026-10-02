'use client';

import { useTranslations } from 'next-intl';
import { Button, Card, Spinner } from '@crm/ui';

const NS = 'platform-payment-gateways.checkout.coupon';

/** The "Have a coupon code?" card of the plan checkout: the input is upper-cased, Enter or Apply checks the code. */
export function CouponCard({
  value,
  onChange,
  onApply,
  busy,
}: {
  value: string;
  onChange: (code: string) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const t = useTranslations(NS);
  return (
    <Card className="flex items-center gap-3 p-4">
      <input
        id="coupon-input"
        name="coupon"
        type="text"
        value={value}
        maxLength={64}
        autoComplete="off"
        aria-label={t('label')}
        placeholder={t('placeholder')}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApply();
          }
        }}
        className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <Button type="button" variant="secondary" id="coupon-apply" disabled={busy} onClick={onApply}>
        {busy && <Spinner label={t('checking')} />}
        {t('apply')}
      </Button>
    </Card>
  );
}
