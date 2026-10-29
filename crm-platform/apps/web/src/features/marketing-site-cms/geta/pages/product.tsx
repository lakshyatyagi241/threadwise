import { ChannelFlow } from '../channel-static';
import { ChannelHero, PracticeTabs } from '../channel-live';
import { CHANNEL_EXTRAS } from '../data/channel-extras';
import { PRODUCTS, hrefOf, productBySlug, type Product } from '../data/products';
import { PRODUCT_SHOT } from '../data/site';
import { Icon } from '../icons';
import { MockFrame } from '../mocks';
import { TintGrid } from '../tint';
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
  // A channel page also gets the animated phone, the message path, the capability tiles and the "in practice" tabs.
  const extra = product.group === 'channels' ? CHANNEL_EXTRAS[product.slug] : undefined;
  const faq = extra ? [...product.faq, ...extra.faq] : product.faq;
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
          extra ? (
            <ChannelHero extra={extra} icon={product.icon} channel={product.name} />
          ) : shot ? (
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

      {extra && extra.chat.some((l) => l.from === 'customer') && (
        <Section soft label="One message, followed through">
          <SecHead
            center
            eyebrow="Behind the chat"
            title={`What happens to a ${product.name} message`}
            lead="It arrives, an agent or a flow answers, and your team gets a contact record that already knows where it came from."
          />
          <ChannelFlow extra={extra} icon={product.icon} channel={product.name} />
        </Section>
      )}

      <Section soft={!extra} label="Capabilities">
        <SecHead eyebrow="Capabilities" title={`What you get with ${product.name}`} />
        <TintGrid features={product.features} />
      </Section>

      {extra ? (
        <Section soft label="In practice">
          <SecHead
            center
            eyebrow="In practice"
            title={`${product.name} at work in different businesses`}
            lead="Pick a business to watch a conversation play out, and see what happened behind it."
          />
          <PracticeTabs extra={extra} icon={product.icon} channel={product.name} />
        </Section>
      ) : (
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
      )}

      <Section soft={!extra} label="FAQ">
        <SecHead center eyebrow="FAQ" title={`${product.name}: common questions`} />
        <FaqList items={faq} />
        <FaqJsonLd items={faq} />
      </Section>

      <Section soft={!!extra} label="Related products">
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
