import { publicSiteInfoSchema, registrationConfigResponseSchema } from '@crm/contracts';
import { cmsPublic, publicApi } from '../../public/api';
import { ContactForm, type ContactLabels } from '../../public/contact-form';
import '../../site/site.css';
import { Icon } from '../icons';
import { Hero, Section } from '../ui';

const LABELS: ContactLabels = {
  name_label: 'Your name',
  email_label: 'Work email',
  company_label: 'Company',
  topic_label: 'What is this about?',
  message_label: 'How can we help?',
  sla: 'We reply within one working day.',
  submit_label: 'Send message',
  success_title: 'Thanks, we have your message',
  success_text: 'Someone from the team will reply by email shortly.',
  error_text: 'Something went wrong sending your message. Please try again.',
};

/** The contact page uses the real contact form (honeypot, captcha, inbox in the admin console). */
export async function ContactPage() {
  const [info, reg] = await Promise.all([
    cmsPublic('/site-info', publicSiteInfoSchema),
    publicApi('/auth/registration-config', registrationConfigResponseSchema),
  ]);
  const email = info?.emailGeneral || info?.emailSupport || '';
  const office = [info?.companyName, info?.address, info?.cityCountry].filter(Boolean);
  return (
    <>
      <Hero
        eyebrow="Contact us"
        title="Talk to a real person"
        sub="Questions about plans, setup, security or partnerships? Send a message and we will get back to you."
        primary={{ href: '#contact-form', label: 'Send a message' }}
        secondary={{ href: '/register', label: 'Start free trial' }}
      />
      <Section id="contact-form" label="Contact form">
        <div className="gx-split" style={{ alignItems: 'start' }}>
          <div className="gx-formcard">
            <ContactForm labels={LABELS} captcha={reg?.captcha ?? null} />
          </div>
          <div>
            <h2 className="gx-h2" style={{ fontSize: '1.6rem' }}>
              Other ways to reach us
            </h2>
            {
              <ul className="gx-list">
                {email && (
                  <li>
                    <Icon name="mail" />
                    <a href={`mailto:${email}`}>{email}</a>
                  </li>
                )}
                {info?.phone && (
                  <li>
                    <Icon name="phone" />
                    <a href={`tel:${info.phone}`}>{info.phone}</a>
                  </li>
                )}
                {info?.whatsapp && (
                  <li>
                    <Icon name="whatsapp" />
                    <a href={`https://wa.me/${info.whatsapp}`} rel="noopener noreferrer">
                      Message us on WhatsApp
                    </a>
                  </li>
                )}
                {office.length > 0 && (
                  <li>
                    <Icon name="pin" />
                    <span>{office.join(', ')}</span>
                  </li>
                )}
                {!email && !info?.phone && !info?.whatsapp && office.length === 0 && (
                  <li>
                    <Icon name="chat" />
                    <span>Use the form and we will reply by email.</span>
                  </li>
                )}
              </ul>
            }
          </div>
        </div>
      </Section>
    </>
  );
}
