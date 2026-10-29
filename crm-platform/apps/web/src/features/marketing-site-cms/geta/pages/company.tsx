import {
  ADVISORS,
  CAREERS_EMAIL,
  COMPANY_FACTS,
  LEADER,
  MILESTONES,
  MISSION,
  PRINCIPLES,
  TEAM,
  WHY_JOIN,
  type Person,
} from '../data/company';
import { SECURITY_POINTS } from '../data/site';
import { TrustBadges } from '../trust';
import { Card, Cta, CtaBand, Hero, SecHead, Section } from '../ui';
import '../about.css';

function PersonCard({ p }: { p: Person }) {
  return (
    <li className="ab-person">
      <img src={p.photo} alt={p.name} width={600} height={600} loading="lazy" decoding="async" />
      <h3>{p.name}</h3>
      <b>{p.title}</b>
      <p>{p.bio}</p>
    </li>
  );
}

export function AboutPage({ brand }: { brand: string }) {
  return (
    <>
      <Hero
        eyebrow="About us"
        title="We help teams talk to customers where they already are"
        sub={`${brand} brings the inbox, WhatsApp and other channels, automation, campaigns and a CRM into one workspace, so small teams can give every customer a fast, personal reply.`}
        secondary={{ href: '/contact', label: 'Contact us' }}
      />

      <Section label="The company">
        <dl className="ab-facts">
          {COMPANY_FACTS.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="ab-statement">{MISSION}</p>
      </Section>

      <Section soft label="What we believe">
        <SecHead
          center
          eyebrow="What we believe"
          title="Three ideas behind the product"
          lead="They decide what we build, what we leave out and how we measure a good week."
        />
        <div className="gx-grid gx-grid-3">
          {PRINCIPLES.map((v) => (
            <Card key={v.title} icon={v.icon} title={v.title} text={v.text} />
          ))}
        </div>
      </Section>

      <Section label="Our story">
        <SecHead center eyebrow="Our story" title="How we got here" />
        <ol className="ab-tl">
          {MILESTONES.map((m) => (
            <li key={m.year}>
              <span className="ab-yr">{m.year}</span>
              <p>{m.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section soft label="Leadership">
        <SecHead
          center
          eyebrow="The people"
          title="Who is building Geta.ai"
          lead="A small team in Pune and beyond, working directly with the businesses that use the product."
        />
        <div className="ab-leader">
          <img
            src={LEADER.photo}
            alt={LEADER.name}
            width={600}
            height={600}
            loading="lazy"
            decoding="async"
          />
          <div>
            <div className="gx-eyebrow">Leadership</div>
            <h3>{LEADER.name}</h3>
            <b>
              {LEADER.title}, {brand}
            </b>
            <p>{LEADER.bio}</p>
            <i>{LEADER.also}</i>
          </div>
        </div>
        <ul className="ab-team">
          {TEAM.map((p) => (
            <PersonCard key={p.name} p={p} />
          ))}
        </ul>
      </Section>

      <Section label="Advisers">
        <SecHead center eyebrow="Advisers" title="People who guide us" />
        <ul className="ab-team ab-team-2">
          {ADVISORS.map((p) => (
            <PersonCard key={p.name} p={p} />
          ))}
        </ul>
      </Section>

      <Section label="Careers">
        <div className="ab-join">
          <div>
            <h2>Want to build this with us?</h2>
            <p>
              We are a small team shipping real product to real businesses, and we like working with
              people who care about craft, speed and customer impact.
            </p>
          </div>
          <Cta href="/careers" variant="white" arrow>
            See how we work
          </Cta>
        </div>
      </Section>

      <CtaBand title="Want to see what we have built?" />
    </>
  );
}

export function CareersPage() {
  return (
    <>
      <Hero
        eyebrow="Careers"
        title="Build the future of customer engagement"
        sub="We are a growing team helping businesses talk to their customers intelligently, across every channel, from one platform."
        primary={{ href: '#open-roles', label: 'See open roles' }}
        secondary={{ href: '/contact', label: 'Get in touch' }}
      />
      <Section label="Why work here">
        <SecHead
          center
          eyebrow="Why work here"
          title="Real products, used by real businesses"
          lead="We look for people who care about craft, speed and the impact of what they ship."
        />
        <div className="gx-grid gx-grid-3">
          {WHY_JOIN.map((w) => (
            <Card key={w.title} icon={w.icon} title={w.title} text={w.text} />
          ))}
        </div>
      </Section>
      <Section soft id="open-roles" label="Open roles">
        <SecHead center eyebrow="Open roles" title="We are always glad to hear from good people" />
        <div className="ab-roles">
          <p>
            No roles are listed right now. If you think you would fit, tell us what you would work
            on.
          </p>
          <Cta href={`mailto:${CAREERS_EMAIL}`} arrow>
            {CAREERS_EMAIL}
          </Cta>
          <span>Send a short note and a link to something you have built or written.</span>
        </div>
      </Section>
    </>
  );
}

export function SecurityPage() {
  return (
    <>
      <Hero
        eyebrow="Security"
        title="Built to keep every customer’s conversations separate and safe"
        sub="Isolation, access control and an audit trail are part of how the platform is built. Here is what is in place today."
        primary={{ href: '/contact', label: 'Ask a security question' }}
        secondary={{ href: '/legal/privacy', label: 'Privacy policy' }}
      />
      <Section label="Controls">
        <SecHead eyebrow="Controls" title="What protects your workspace" />
        <div className="gx-grid gx-grid-3">
          {SECURITY_POINTS.map((s) => (
            <Card key={s.title} icon={s.icon} title={s.title} text={s.text} green />
          ))}
        </div>
      </Section>
      <Section soft label="Compliance">
        <SecHead
          center
          eyebrow="Compliance"
          title="Independently assessed, openly documented"
          lead="Need a data processing agreement, a security questionnaire or details of where data is stored? Contact us and we will answer directly."
        />
        <TrustBadges />
      </Section>
      <CtaBand
        title="Have a security review to complete?"
        text="Send us your questionnaire and we will respond."
      />
    </>
  );
}
