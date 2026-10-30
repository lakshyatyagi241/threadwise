import Link from 'next/link';
import { AgentTabs } from '../agent-tabs';
import { Bento } from '../bento';
import { ScrollPanel } from '../scroll-panel';
import { HeroGrid } from '../hero-grid';
import { CopilotLayer } from '../copilot-layer';
import { NICHES } from '../data/niches';
import { CHANNELS, PRODUCTS } from '../data/products';
import { HOME, HOME_FAQ, PLATFORM_LAYERS } from '../data/site';
import { Explainer } from '../explainer';
import { HeroArt } from '../hero-art';
import { HeroRotator } from '../hero-rotator';
import { Icon } from '../icons';
import { LayerStack } from '../layer-stack';
import { Modules } from '../modules';
import { NichePicker } from '../niche-picker';
import { OneTool } from '../one-tool';
import { TeamSection } from '../team-section';
import { LogoStrip, Testimonials, TrustBadges } from '../trust';
import {
  Assurances,
  Card,
  Cta,
  FaqJsonLd,
  FaqList,
  OrgJsonLd,
  SecHead,
  Section,
  Wrap,
} from '../ui';

export function HomePage() {
  const capabilities = PRODUCTS.reduce((n, p) => n + p.features.length, 0);

  return (
    <>
      <OrgJsonLd />
      <ScrollPanel label="Why one platform" />
      <HeroGrid />
      <header className="gx-hero">
        <Wrap>
          <div className="gx-hero-grid">
            <div>
              <div className="gx-eyebrow">{HOME.eyebrow}</div>
              <h1 className="gx-h1" style={{ maxWidth: 900, margin: '16px auto 0' }}>
                {HOME.lead} <HeroRotator phrases={NICHES.map((x) => x.phrase)} />
              </h1>
              <p className="gx-lead">{HOME.sub}</p>
              <div className="gx-cta-row">
                <Cta href="/register">Start free trial</Cta>
                <Cta href="#journey" variant="ghost">
                  See how it works
                </Cta>
              </div>
              <Assurances items={HOME.assurances} />
            </div>
            <div className="gx-hero-visual">
              <HeroArt />
            </div>
          </div>
        </Wrap>
      </header>

      <Section tone="soft" label="Built for your business">
        <SecHead
          center
          eyebrow="Pick your business"
          title="Start with what your business needs"
          lead="You do not need everything on day one. Choose your kind of business and see the few things it turns on. Add the rest whenever you grow."
        />
        <NichePicker />
      </Section>

      <Section label="Why one platform">
        <OneTool />
      </Section>

      <Section tone="soft" label="Customers">
        <p style={{ textAlign: 'center', fontSize: 14, margin: '0 0 22px', fontWeight: 600 }}>
          Trusted by teams in education, healthcare, real estate, events and finance
        </p>
        <LogoStrip />
      </Section>

      <Section label="For your team">
        <TeamSection />
      </Section>

      <Section tone="soft" label="Modules">
        <SecHead
          center
          eyebrow="The modules"
          title="Start with what you need. Add the rest when you grow."
          lead="Each module works on its own and shares the same contact record, so adding one later never means starting over."
        />
        <Modules />
        <p style={{ textAlign: 'center', margin: '34px 0 0', fontSize: 15 }}>
          Works on WhatsApp, email, SMS, Instagram, website chat and more.{' '}
          <Link href="/products/channels" style={{ color: 'var(--gx-blue)', fontWeight: 700 }}>
            See all channels
          </Link>
        </p>
      </Section>

      <Section id="journey" label="The customer journey">
        <SecHead
          center
          eyebrow="How it works"
          title="From first message to repeat customer"
          lead="Follow one lead through the platform: the agent answers, the CRM updates, your team takes over, the deal moves and a campaign brings them back."
        />
        <Explainer />
      </Section>

      <Section tone="soft" label="What the platform does">
        <SecHead
          center
          eyebrow="The platform"
          title="Everything your team needs, working together"
          lead="Agents, inbox, CRM, campaigns and integrations share one contact record, so nothing is copied between tools."
        />
        <Bento />
      </Section>

      <Section label="AI agents">
        <SecHead
          center
          eyebrow="Agentic AI"
          title="One AI agent. Every channel it needs."
          lead="Train an agent on your own content, put it on your website and WhatsApp, and let it answer, qualify and hand over while your team focuses on the conversations that need a person."
        />
        <AgentTabs />
        <div className="gx-cta-row" style={{ justifyContent: 'center' }}>
          <Cta href="/products/ai-agents" variant="ghost">
            Explore AI agents
          </Cta>
        </div>
      </Section>

      <Section tone="soft" label="Optional assistant">
        <CopilotLayer />
      </Section>

      <Section label="The platform in five layers">
        <div className="gx-layers">
          <div>
            <div className="gx-eyebrow">About the platform</div>
            <h2 className="gx-h2">One platform. Five layers. Nothing to stitch together.</h2>
            <p className="gx-lead">
              Agents act, channels engage, the CRM remembers, integrations connect and the
              Marketplace extends. Every layer shares one contact record, one login and one set of
              permissions.
            </p>
            <ul className="gx-layerlist">
              {PLATFORM_LAYERS.map((l) => (
                <li key={l.n}>
                  <Link href={l.href}>
                    <span className="n">{l.n}</span>
                    <span>
                      <b>{l.title}</b>
                      <span className="t">{l.text}</span>
                    </span>
                    <Icon name="arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <LayerStack
            products={PRODUCTS.length}
            capabilities={capabilities}
            channels={CHANNELS.length}
          />
        </div>
      </Section>

      <Section tone="soft" label="Marketplace and add-ons">
        <div className="gx-split">
          <div>
            <div className="gx-eyebrow">Marketplace and add-ons</div>
            <h2 className="gx-h2">Extend it your way, without custom code</h2>
            <p className="gx-lead">
              Install mini apps and integrations from the Marketplace after reviewing exactly what
              they can access. Need more room? Add-ons stack on top of your plan.
            </p>
            <ul className="gx-list">
              {[
                'Every permission listed with a risk level before you approve',
                'Pause, test or uninstall an app at any time',
                'Request an integration and vote on what others asked for',
                'Add-ons raise limits and unlock features, monthly',
              ].map((t) => (
                <li key={t}>
                  <Icon name="check" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="gx-cta-row">
              <Cta href="/products/marketplace">Explore the Marketplace</Cta>
            </div>
          </div>
          <div className="gx-grid gx-grid-2">
            <Card icon="puzzle" title="Mini apps" text="Add a capability in minutes." />
            <Card icon="plug" title="Integrations" text="Connect outside services." />
            <Card
              icon="shield"
              title="Permission review"
              text="Approve what each app can access."
            />
            <Card icon="plus" title="Add-ons" text="Feature and limit packs on your plan." />
          </div>
        </div>
      </Section>

      <Section label="Customer stories">
        <SecHead
          center
          eyebrow="Customer stories"
          title="What teams say after switching"
          lead="From a university, a real estate team and a hospital."
        />
        <Testimonials />
      </Section>

      <Section tone="soft" label="Security and reviews">
        <SecHead
          center
          eyebrow="Trust"
          title="Built to be trusted with your customers’ conversations"
          lead="Workspace isolation, roles and permissions, and an audit trail are part of the product."
        />
        <TrustBadges />
        <div className="gx-cta-row" style={{ justifyContent: 'center' }}>
          <Cta href="/security" variant="ghost">
            Read about security
          </Cta>
        </div>
      </Section>

      <Section label="FAQ">
        <SecHead center eyebrow="FAQ" title="Questions people ask first" />
        <FaqList items={HOME_FAQ} />
        <FaqJsonLd items={HOME_FAQ} />
      </Section>
    </>
  );
}
