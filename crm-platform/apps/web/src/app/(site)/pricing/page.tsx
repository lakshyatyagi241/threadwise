import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { publicFaqListResponseSchema, publicPricingResponseSchema } from '@crm/contracts';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { PricingView } from '@/features/plans-subscriptions-trials/public/pricing-view';
import { apiBase } from '@/lib/auth/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.public');
  return { title: t('title'), description: t('lead') };
}

/** The public FAQ list for the pricing page: the same table the in-app picker reads (TW-PLAN-009). */
async function loadFaqs() {
  try {
    const res = await fetch(`${apiBase()}/v2/public/pricing-faqs?for=pricing`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const parsed = publicFaqListResponseSchema.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data : { data: [] };
  } catch {
    return { data: [] };
  }
}

/** The public pricing page (TW-PLAN-010). Never cached: a price change shows at once. */
export default async function PricingPage() {
  const [pricing, faqs] = await Promise.all([
    cmsPublic('/pricing', publicPricingResponseSchema),
    loadFaqs(),
  ]);
  return (
    <PricingView
      pricing={pricing ?? { plans: [], yearlyToggle: false, yearlyDiscountPct: 0 }}
      faqs={faqs}
    />
  );
}
