import { ALL_PRODUCTS, CHANNELS, PRODUCT_GROUPS, PRODUCTS, hrefOf } from '../data/products';
import { StatCards } from '../tint';
import { Card, CtaBand, Hero, SecHead, Section } from '../ui';

export function PlatformPage() {
  return (
    <>
      <Hero
        eyebrow="Platform overview"
        title="The agentic AI engagement platform with a CRM built in"
        sub="AI agents, inbox, channels, automation, campaigns and CRM share one contact record and one login. Pick a product to see how it works."
        points={[
          `${PRODUCTS.length} products and ${CHANNELS.length} channels, one workspace`,
          'Start small and grow',
          'Roles and permissions throughout',
        ]}
        secondary={{ href: '/get-started', label: 'Find your fit' }}
      />
      <Section label="The platform in numbers">
        <StatCards
          stats={[
            {
              to: PRODUCTS.length,
              label: 'Products',
              text: 'Inbox, agents, campaigns, CRM and more, working as one platform.',
            },
            {
              to: PRODUCTS.reduce((n, p) => n + p.features.length, 0),
              suffix: '+',
              label: 'Capabilities',
              text: 'Everything they can do, listed on each product page.',
            },
            {
              to: CHANNELS.length,
              label: 'Channels',
              text: 'WhatsApp, email, SMS, calling, social and your website, in one inbox.',
            },
          ]}
        />
      </Section>
      {(Object.keys(PRODUCT_GROUPS) as Array<keyof typeof PRODUCT_GROUPS>).map((g, i) => (
        <Section key={g} soft={i % 2 === 0} label={PRODUCT_GROUPS[g].label}>
          <SecHead eyebrow={PRODUCT_GROUPS[g].label} title={PRODUCT_GROUPS[g].blurb} />
          <div className="gx-grid gx-grid-3">
            {ALL_PRODUCTS.filter((p) => p.group === g).map((p) => (
              <Card
                key={p.slug}
                icon={p.icon}
                title={p.name}
                text={p.sub}
                href={hrefOf(p)}
                more="Explore"
              />
            ))}
          </div>
        </Section>
      ))}
      <CtaBand />
    </>
  );
}
