import { Suspense } from 'react';
import { CheckoutPage } from '@/features/platform-payment-gateways/components/checkout-page';

export default function WalletCheckoutPage() {
  return (
    <Suspense>
      <CheckoutPage target={{ kind: 'wallet' }} />
    </Suspense>
  );
}
