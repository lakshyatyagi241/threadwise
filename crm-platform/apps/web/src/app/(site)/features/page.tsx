import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { ALL_PRODUCTS } from '@/features/marketing-site-cms/geta/data/products';
import { FeaturesIndex } from '@/features/marketing-site-cms/geta/pages/features-index';
import { CtaBand, Hero, Section } from '@/features/marketing-site-cms/geta/ui';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/features',
    title: 'All features: inbox, AI agents, CRM, campaigns',
    description:
      'Search every Geta.ai feature: shared inbox, WhatsApp and email, AI agents, flows, broadcasts, forms, CRM, appointments, commerce and integrations.',
  });

export default function Page() {
  return (
    <>
      <Hero
        eyebrow="All features"
        title="Everything the platform can do"
        sub="Search or filter every capability, then jump to the product page for the full picture."
        secondary={{ href: '/get-started', label: 'Find your fit' }}
      />
      <Section label="Feature list">
        <FeaturesIndex products={ALL_PRODUCTS} />
      </Section>
      <CtaBand />
    </>
  );
}
