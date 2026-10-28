import type { Metadata } from 'next';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { GetStarted } from '@/features/marketing-site-cms/geta/pages/get-started';
import { Hero, Section } from '@/features/marketing-site-cms/geta/ui';

export const generateMetadata = (): Promise<Metadata> =>
  pageMeta({
    path: '/get-started',
    title: 'Find your fit: the right Geta.ai setup for you',
    description:
      'Tell us what you want to do and what kind of business you run, and we will point you to the Geta.ai products and examples that match.',
  });

export default function Page() {
  return (
    <>
      <Hero
        eyebrow="Find your fit"
        title="Not sure where to start?"
        sub="Two quick questions, and we will show you the products and examples that match what you want to do."
        primary={{ href: '/features', label: 'Browse all features' }}
        secondary={null}
      />
      <Section label="Quiz">
        <GetStarted />
      </Section>
    </>
  );
}
