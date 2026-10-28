import { ALL_PRODUCTS, CHANNELS, PRODUCT_GROUPS, PRODUCTS, hrefOf } from '../data/products';
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
