import { Suspense } from 'react';
import { CheckoutPage } from '@/features/platform-payment-gateways/components/checkout-page';

export default async function PlanCheckoutPage({ params }: { params: Promise<{ planSlug: string }> }) {
  const { planSlug } = await params;
  return (
    <Suspense>
      <CheckoutPage target={{ kind: 'plan', planSlug }} />
    </Suspense>
  );
}
