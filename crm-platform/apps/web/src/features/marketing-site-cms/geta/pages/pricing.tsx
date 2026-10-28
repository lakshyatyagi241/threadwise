import { publicFaqListResponseSchema, publicPricingResponseSchema } from '@crm/contracts';
import { cmsPublic, publicApi } from '../../public/api';
import { PlanCards, type PlanOutline } from '../plan-cards';
import { PRICING_FAQ } from '../data/site';
import { CtaBand, FaqJsonLd, FaqList, Hero, SecHead, Section } from '../ui';

/** Shown only while the plan catalogue has no active plan. Words, not promises: no limit or amount appears. */
const OUTLINES: PlanOutline[] = [
  {
    name: 'Starter',
    tagline: 'One shared inbox and one contact list for a small team.',
    rows: ['Team inbox', 'Contacts and CRM', 'Website chat and WhatsApp', 'Forms and lead capture'],
  },
  {
    name: 'Growth',
    tagline: 'Automation and AI agents on top of the basics.',
    highlighted: true,
    rows: [
      'Everything in Starter',
      'Broadcasts and campaigns',
      'Chatbots and flows',
      'AI agents',
      'Appointments and deals',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Larger volumes and special requirements.',
    rows: [
      'Everything in Growth',
      'Custom limits',
      'Roles and permissions',
      'Integrations and API',
      'Marketplace add-ons',
    ],
  },
];

/** Plan cards come from the plan catalogue (the same data the checkout uses), shown without amounts. */
export async function PricingPage() {
  const [pricing, tableFaqs] = await Promise.all([
    cmsPublic('/pricing', publicPricingResponseSchema),
    publicApi('/public/pricing-faqs', publicFaqListResponseSchema, { for: 'pricing' }),
  ]);
  const faqs = [
    ...PRICING_FAQ,
    ...(tableFaqs?.data ?? []).map((f) => ({ q: f.question, a: f.answer })),
  ];
  return (
    <>
      <Hero
        eyebrow="Plans"
        title="Plans built around what you turn on"
        sub="Start with the modules you need, then add more, or the optional AI layer, when you are ready. Tell us your team and volumes and we will send a quote the same day."
        primary={{ href: '/contact', label: 'Contact us' }}
        secondary={{ href: '/platform', label: 'Explore the platform' }}
      />
      <Section label="Plans">
        <PlanCards pricing={pricing} outlines={OUTLINES} />
        <p className="pc-note">
          Amounts are agreed with our team so that you only pay for what you use.{' '}
          <a href="/contact">Contact us</a> for a quote.
        </p>
      </Section>
      <Section tone="soft" label="Plan questions">
        <SecHead center eyebrow="FAQ" title="Questions about plans" />
        <FaqList items={faqs} />
        <FaqJsonLd items={faqs} />
      </Section>
      <CtaBand
        title="Not sure which plan fits?"
        text="Tell us about your team and we will help you size it."
      />
    </>
  );
}
