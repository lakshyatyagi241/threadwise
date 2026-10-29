import { CHANNELS, hrefOf } from '../data/products';
import { Card, CtaBand, FaqJsonLd, FaqList, Hero, SecHead, Section, Steps } from '../ui';

const FAQ = [
  {
    q: 'Do all channels work the same way?',
    a: 'Conversations from WhatsApp, email, Instagram, Facebook, Telegram, web chat, LINE, Viber and WeChat arrive in the same team inbox. SMS is send-only, used from broadcasts and campaigns, and voice is WhatsApp calling from the inbox.',
  },
  {
    q: 'Is one contact split across channels?',
    a: 'Contacts are matched on phone and email, so the same person on two channels stays one record with one history.',
  },
  {
    q: 'Can I start with one channel and add more later?',
    a: 'Yes. Connect the channel you need today. The others are in the same workspace when you want them.',
  },
];

const NOTE: Record<string, string> = {
  sms: 'Send only',
  voice: 'WhatsApp calls',
};

export function ChannelsHubPage() {
  return (
    <>
      <Hero
        eyebrow="Channels"
        title="Every channel your customers use. One inbox."
        sub="WhatsApp, email, SMS, voice, Instagram, Facebook, Telegram, web chat, LINE, Viber and WeChat. Connect the ones you need and answer them all in one place, against one contact record."
        points={[
          'One shared team inbox',
          'One contact record per person',
          'Add channels as you grow',
        ]}
        secondary={{ href: '/get-started', label: 'Find your fit' }}
      />
      <Section label="All channels">
        <SecHead
          center
          eyebrow="Pick a channel"
          title="Here is what each one does"
          lead="Each page says plainly what the channel can and cannot do."
        />
        <div className="gx-grid gx-grid-3">
          {CHANNELS.map((c) => (
            <Card
              key={c.slug}
              icon={c.icon}
              title={NOTE[c.slug] ? `${c.name} · ${NOTE[c.slug]}` : c.name}
              text={c.short}
              href={hrefOf(c)}
              more="More details"
            />
          ))}
        </div>
      </Section>
      <Section tone="soft" label="How channels work together">
        <SecHead center eyebrow="Together" title="One conversation view, whatever the channel" />
        <Steps
          items={[
            {
              title: 'Connect',
              text: 'Link each channel with guided setup. Credentials are stored sealed.',
            },
            {
              title: 'Converge',
              text: 'Messages from every channel land in the team inbox and match the same contact.',
            },
            {
              title: 'Respond',
              text: 'Route, reply, automate with flows and AI agents, and follow up with campaigns.',
            },
          ]}
        />
      </Section>
      <Section label="Channel FAQ">
        <SecHead center eyebrow="FAQ" title="Channel questions" />
        <FaqList items={FAQ} />
        <FaqJsonLd items={FAQ} />
      </Section>
      <CtaBand title="Bring your channels into one inbox." />
    </>
  );
}
