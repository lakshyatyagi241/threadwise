import { forwardPaymentWebhook } from '@/features/storefront-builder/public/api/proxy';

export const dynamic = 'force-dynamic';

/** Razorpay's `payment_link.paid` for shop payment links (Reference's `/webhooks/storefront-pay`); the API verifies the signature. */
export async function POST(req: Request) {
  return forwardPaymentWebhook(req);
}
