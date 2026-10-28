import { ABOUT_VALUES, SECURITY_POINTS } from '../data/site';
import { TrustBadges } from '../trust';
import { Card, CtaBand, Hero, SecHead, Section } from '../ui';

export function AboutPage({ brand }: { brand: string }) {
  return (
    <>
      <Hero
        eyebrow="About us"
        title={`We help teams talk to customers where they already are`}
        sub={`${brand} brings the inbox, WhatsApp and other channels, automation, campaigns and a CRM into one workspace, so small teams can give every customer a fast, personal reply.`}
        secondary={{ href: '/contact', label: 'Contact us' }}
      />
      <Section label="What we believe">
        <SecHead eyebrow="What we believe" title="Three ideas behind the product" />
        <div className="gx-grid gx-grid-3">
          {ABOUT_VALUES.map((v) => (
            <Card key={v.title} icon={v.icon} title={v.title} text={v.text} />
          ))}
        </div>
      </Section>
      <CtaBand title="Want to see what we have built?" />
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
