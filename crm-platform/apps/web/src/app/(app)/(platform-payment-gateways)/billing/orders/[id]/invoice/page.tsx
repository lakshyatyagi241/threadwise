import { BuyerInvoicePage } from '@/features/platform-payment-gateways/components/buyer-invoice-page';

export default async function BillingOrderInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BuyerInvoicePage id={id} />;
}
