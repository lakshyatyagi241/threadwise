import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicOrder } from '../api/server';
import { OrderTracking } from '../components/order-tracking';
import { orderMetadata } from '../lib/seo';

/** The tracking page (TW-STORE-017). A wrong token, another shop's order or a disabled shop is a 404. */
export async function ShopOrder({ slug, token }: { slug: string; token: string }) {
  const data = await getPublicOrder(slug, token);
  if (!data) notFound();
  return <OrderTracking data={data} />;
}

export async function shopOrderMetadata(slug: string, token: string): Promise<Metadata> {
  const data = await getPublicOrder(slug, token);
  if (!data) return { title: { absolute: 'Order' }, robots: { index: false } };
  return orderMetadata(data.shop, data.order.orderNo);
}
