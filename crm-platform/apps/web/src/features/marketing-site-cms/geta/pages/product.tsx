import { PRODUCTS, hrefOf, productBySlug, type Product } from '../data/products';
import { PRODUCT_SHOT } from '../data/site';
import { Icon } from '../icons';
import { MockFrame } from '../mocks';
import {
  Card,
  CtaBand,
  FaqJsonLd,
  FaqList,
  FeatureWindow,
  Hero,
  SecHead,
  Section,
  Steps,
} from '../ui';

export function ProductPage({ product }: { product: Product }) {
  const shot = PRODUCT_SHOT[product.slug];
  const related = product.related.map(productBySlug).filter((p): p is Product => !!p);
  return (
    <>
      <Hero
        crumbs={
          product.group === 'channels'
            ? [{ label: 'Channels', href: '/products/channels' }, { label: product.name }]
            : [{ label: 'Product', href: '/platform' }, { label: product.name }]
        }
        eyebrow={product.name}
        title={product.headline}
        sub={product.sub}
        points={product.points}
        visual={
          shot ? (
            <MockFrame id={shot} alt={`${product.name} in the app, drawn with sample data`} />
          ) : (
            <FeatureWindow title={product.name} rows={product.features} />
          )
        }
      />

      <Section label="How it works">
        <SecHead eyebrow="How it works" title={`${product.name} in three steps`} />
        <Steps items={product.how} />
      </Section>

      <Section soft label="Capabilities">
        <SecHead eyebrow="Capabilities" title={`What you get with ${product.name}`} />
        <div className="gx-grid gx-grid-4">
          {product.features.map((f) => (
            <Card key={f.title} icon={f.icon} title={f.title} text={f.text} />
          ))}
        </div>
      </Section>

      <Section label="Example">
        <div className="gx-split">
          <div>
            <div className="gx-eyebrow">In practice</div>
            <h2 className="gx-h2">{product.example.title}</h2>
            <ul className="gx-list">
              {product.example.steps.map((s) => (
                <li key={s}>
                  <Icon name="check" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <FeatureWindow
            title="Works with"
            rows={related.map((r) => ({ title: r.name, text: r.short, icon: r.icon }))}
          />
        </div>
      </Section>

      <Section soft label="FAQ">
        <SecHead center eyebrow="FAQ" title={`${product.name}: common questions`} />
        <FaqList items={product.faq} />
        <FaqJsonLd items={product.faq} />
      </Section>

      <Section label="Related products">
        <SecHead eyebrow="Keep exploring" title="Works best together" />
        <div className="gx-grid gx-grid-3">
          {related.map((r) => (
            <Card
              key={r.slug}
              icon={r.icon}
              title={r.name}
              text={r.short}
              href={hrefOf(r)}
              more="Explore"
            />
          ))}
        </div>
      </Section>

      <CtaBand title={`Try ${product.name} with your own team.`} />
    </>
  );
}

export const allProductSlugs = () => PRODUCTS.map((p) => p.slug);
