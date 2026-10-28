import { hrefOf, productBySlug, type Product } from '../data/products';
import type { Solution } from '../data/solutions';
import { Card, ChatMock, CtaBand, FaqJsonLd, FaqList, Hero, SecHead, Section, Steps } from '../ui';

export function SolutionPage({ solution }: { solution: Solution }) {
  const products = solution.products.map(productBySlug).filter((p): p is Product => !!p);
  const industry = solution.kind === 'industry';
  return (
    <>
      <Hero
        crumbs={[{ label: industry ? 'Solutions' : 'Use cases' }, { label: solution.name }]}
        eyebrow={industry ? `For ${solution.name.toLowerCase()}` : solution.name}
        title={solution.headline}
        sub={solution.sub}
        visual={<ChatMock title={solution.scenario.title} lines={solution.scenario.lines} />}
      />

      <Section label="Challenges">
        <SecHead eyebrow="The problem" title="What gets in the way today" />
        <div className="gx-grid gx-grid-3">
          {solution.pains.map((p) => (
            <Card key={p.title} title={p.title} text={p.text} />
          ))}
        </div>
      </Section>

      <Section soft label="How it works">
        <SecHead eyebrow="How it works" title="From first message to result" />
        <Steps items={solution.steps} />
      </Section>

      <Section label="Products used">
        <SecHead
          eyebrow="What powers it"
          title="The products behind this setup"
          lead="Everything here is part of one platform, so there is nothing extra to buy or connect."
        />
        <div className="gx-grid gx-grid-4">
          {products.map((p) => (
            <Card
              key={p.slug}
              icon={p.icon}
              title={p.name}
              text={p.short}
              href={hrefOf(p)}
              more="Explore"
            />
          ))}
        </div>
      </Section>

      <Section soft label="FAQ">
        <SecHead center eyebrow="FAQ" title="Common questions" />
        <FaqList items={solution.faq} />
        <FaqJsonLd items={solution.faq} />
      </Section>

      <CtaBand
        title={`See how this works for ${industry ? solution.name.toLowerCase() : 'your team'}.`}
      />
    </>
  );
}
