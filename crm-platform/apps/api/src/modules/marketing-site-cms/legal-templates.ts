import type { LegalSection, LegalSlug } from '@crm/contracts';

/**
 * Starter documents for the five legal pages (WD-CMS-036). They are generic templates written for this port, not
 * WaDesk's text, and they say so in their subtitle: they must be reviewed and adapted by counsel before the site goes
 * live. `{{brand}}` is replaced with the platform's name when the row is created.
 */
export interface LegalTemplate {
  slug: LegalSlug;
  title: string;
  subtitle: string;
  sort: number;
  sections: Array<Omit<LegalSection, 'n'>>;
}

const NOTE =
  'Template text. Have it reviewed by counsel and adapt it to your business before publishing.';

const p = (...parts: string[]): string => parts.map((t) => `<p>${t}</p>`).join('');

export const LEGAL_TEMPLATES: readonly LegalTemplate[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    subtitle: NOTE,
    sort: 1,
    sections: [
      {
        title: 'Agreement',
        body: p(
          'By creating an account or using {{brand}} you agree to these terms. If you use the service for an organisation, you confirm you may accept them on its behalf.',
        ),
      },
      {
        title: 'Your account',
        body: p(
          'Keep your sign-in details private and tell us promptly if you suspect misuse. You are responsible for activity under your account and for the people you invite to your workspace.',
        ),
      },
      {
        title: 'Acceptable use',
        body: p(
          'Use the service lawfully and in line with our acceptable use policy. Do not use it to send unsolicited messages, to harass people, or to interfere with the service or other customers.',
        ),
      },
      {
        title: 'Your content and data',
        body: p(
          'You keep ownership of the content and contact data you add. You allow us to process it only to provide and secure the service, as described in our privacy policy.',
        ),
      },
      {
        title: 'Plans and payment',
        body: p(
          'Paid plans are billed in advance for the period shown at checkout. Prices may change for future periods with notice. Taxes are added where they apply.',
        ),
      },
      {
        title: 'Availability',
        body: p(
          'We work to keep the service available but do not promise it will be uninterrupted or error free. We may change or retire features with reasonable notice.',
        ),
      },
      {
        title: 'Ending the agreement',
        body: p(
          'You may close your account at any time. We may suspend or end access if these terms are broken or if required by law. Some sections continue to apply after the agreement ends.',
        ),
      },
      {
        title: 'Liability',
        body: p(
          'To the extent the law allows, our total liability is limited to the amount you paid for the service in the twelve months before the claim, and we are not liable for indirect or consequential loss.',
        ),
      },
      {
        title: 'Contact',
        body: p('Questions about these terms can be sent through the contact page of this site.'),
      },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    subtitle: NOTE,
    sort: 2,
    sections: [
      {
        title: 'What this policy covers',
        body: p(
          'This policy explains what personal data {{brand}} collects, why, and the choices you have. It applies to this website and to the service.',
        ),
      },
      {
        title: 'Data we collect',
        body: p(
          'Account details you give us, messages and contact records you add to your workspace, billing details handled by our payment partners, and technical data such as device type and IP address.',
        ),
      },
      {
        title: 'How we use it',
        body: p(
          'To provide, secure and improve the service, to bill you, to answer your requests and to meet legal duties. We do not sell personal data.',
        ),
      },
      {
        title: 'Sharing',
        body: p(
          'We share data only with service providers who help us run the service, under written terms, and where the law requires it.',
        ),
      },
      {
        title: 'Retention',
        body: p(
          'We keep data for as long as your account is active and for a limited period afterwards for legal and backup reasons, then delete or anonymise it.',
        ),
      },
      {
        title: 'Your rights',
        body: p(
          'Depending on where you live you may ask to access, correct, export or delete your data, or object to some processing. Use the contact page to make a request.',
        ),
      },
      {
        title: 'Security',
        body: p(
          'We use technical and organisational measures to protect data, including access controls and encryption in transit. No system is perfectly secure.',
        ),
      },
    ],
  },
  {
    slug: 'refund',
    title: 'Refund and Payment Policy',
    subtitle: NOTE,
    sort: 3,
    sections: [
      {
        title: 'Billing',
        body: p(
          'Paid plans renew automatically for the period you chose until you cancel. The price and period are shown before you pay.',
        ),
      },
      {
        title: 'Cancelling',
        body: p(
          'You can cancel any time from your account. Access continues until the end of the period you have paid for.',
        ),
      },
      {
        title: 'Refunds',
        body: p(
          'Payments are generally non-refundable once a period has started, unless the law says otherwise or we agree in writing. If something went wrong with a charge, contact us and we will look into it.',
        ),
      },
      {
        title: 'Failed payments',
        body: p('If a payment fails we may retry it and may limit access until it succeeds.'),
      },
      {
        title: 'Taxes',
        body: p(
          'Prices exclude taxes unless stated. Taxes are calculated at checkout where they apply.',
        ),
      },
    ],
  },
  {
    slug: 'cookies',
    title: 'Cookie Policy',
    subtitle: NOTE,
    sort: 4,
    sections: [
      {
        title: 'What cookies are',
        body: p(
          'Cookies are small files stored on your device. We also use similar technologies such as local storage.',
        ),
      },
      {
        title: 'Cookies we use',
        body: p(
          'Strictly necessary cookies keep you signed in and protect the service. Preference cookies remember settings such as language and theme.',
        ),
      },
      {
        title: 'Analytics',
        body: p(
          'If analytics are enabled on this site, they run only after you agree in the cookie banner.',
        ),
      },
      {
        title: 'Managing cookies',
        body: p(
          'You can change your choice at any time and you can block or delete cookies in your browser settings. Blocking necessary cookies may stop the service from working.',
        ),
      },
      {
        title: 'Changes',
        body: p(
          'We may update this policy and will show the date of the latest change at the top of the page.',
        ),
      },
    ],
  },
  {
    slug: 'acceptable-use',
    title: 'Acceptable Use Policy',
    subtitle: NOTE,
    sort: 5,
    sections: [
      {
        title: 'Purpose',
        body: p(
          'This policy keeps {{brand}} safe and useful for everyone. It applies to all customers and their users.',
        ),
      },
      {
        title: 'Messaging',
        body: p(
          'Only message people who have agreed to hear from you, honour opt-out requests quickly and follow the rules of each channel you connect.',
        ),
      },
      {
        title: 'Prohibited content',
        body: p(
          'Do not send illegal, deceptive, hateful or abusive content, malware, or content that infringes the rights of others.',
        ),
      },
      {
        title: 'Prohibited behaviour',
        body: p(
          'Do not probe, overload or bypass the security of the service, resell access without permission, or collect data you are not entitled to.',
        ),
      },
      {
        title: 'Enforcement',
        body: p(
          'We may remove content, limit features or suspend accounts that break this policy, and we may report unlawful activity to the authorities.',
        ),
      },
      {
        title: 'Reporting',
        body: p(
          'Report abuse or security concerns through the contact page and we will investigate.',
        ),
      },
    ],
  },
];

/** The template for a slug with the brand filled in and sections numbered 01, 02, ... */
export function legalTemplate(slug: LegalSlug, brand: string) {
  const t = LEGAL_TEMPLATES.find((x) => x.slug === slug)!;
  // The brand lands inside HTML, so it is escaped (APP_NAME is operator configuration, but never trust it into markup).
  const safe = brand.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fill = (s: string) => s.replace(/\{\{brand\}\}/g, safe);
  return {
    slug: t.slug,
    title: t.title,
    subtitle: fill(t.subtitle),
    sort: t.sort,
    sections: t.sections.map((s, i) => ({
      n: String(i + 1).padStart(2, '0'),
      title: fill(s.title),
      body: fill(s.body),
    })),
  };
}
