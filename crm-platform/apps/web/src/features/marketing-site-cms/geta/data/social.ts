/**
 * Trust content taken from the existing geta.ai site (the owner asked for it to carry over): customer logos, customer
 * testimonials, compliance badges and review-site ratings. Logo files live in /public/geta/customers and the badge
 * images in /public/geta/certs. Keep these in step with geta.ai; they are claims about the company, not the code.
 */

export const CUSTOMER_LOGOS: Array<{ file: string; name: string; sector: string }> = [
  { file: '3.png', name: 'SIBM Pune', sector: 'Education' },
  { file: '4.png', name: 'Somaiya Vidyavihar', sector: 'Education' },
  { file: '5.png', name: 'Victorious Kidss Educares', sector: 'Education' },
  { file: '23.png', name: 'MBA Affairs Expo', sector: 'Events' },
  { file: '12.png', name: 'Universal Media', sector: 'Events' },
  { file: '13.png', name: 'Dhanashree Hospital', sector: 'Healthcare' },
  { file: '15.png', name: 'Thrive Astro Wellness', sector: 'Healthcare' },
  { file: '11.png', name: 'Darshana', sector: 'Real Estate' },
  { file: '1.png', name: 'Easebuzz', sector: 'Finance' },
];

export interface Testimonial {
  id: string;
  tab: string;
  quote: string;
  person: string;
  role: string;
  /** The drawn portrait and the small sector badge on it. */
  look: 'crop' | 'sweep' | 'curl' | 'bun';
  badge: 'cap' | 'home' | 'heart';
}

export const TESTIMONIALS: Testimonial[] = [
  {
    id: 'support',
    tab: 'Customer support',
    quote:
      "I am extremely impressed with Geta's AI chatbot! It flawlessly carries conversations and provides accurate responses. The technology behind Geta's chatbot is top-notch, making it an invaluable tool for customer support. I highly recommend Geta for anyone looking to enhance their customer service experience.",
    person: 'Biju Pillai',
    role: 'Balaji University',
    look: 'crop',
    badge: 'cap',
  },
  {
    id: 'leads',
    tab: 'Lead qualification',
    quote:
      "Geta has made our lead follow-up process much more efficient. The AI Agent responds instantly, understands the customer's property requirements, and helps qualify leads before they reach our sales team. It has helped us ensure that fewer enquiries are missed and our team can focus on serious prospects.",
    person: 'Rahul Sharma',
    role: 'Marketing Manager, Urban Rest Realty',
    look: 'sweep',
    badge: 'home',
  },
  {
    id: 'ops',
    tab: 'Operations',
    quote:
      "Geta.ai has made patient feedback collection and review far easier and more organized for our team. Mr. Sumeet in particular has been consistently helpful, responsive, and supportive throughout the process. Overall, we're very satisfied with the platform and the support that comes with it.",
    person: 'Raja T',
    role: 'Team Leader, SRM Global Hospital',
    look: 'curl',
    badge: 'heart',
  },
];

export const CERTIFICATIONS: Array<{ file: string; name: string }> = [
  { file: 'soc-2-type-ii.png', name: 'SOC 2 Type II' },
  { file: 'iso-27001.png', name: 'ISO 27001' },
  { file: 'gdpr-ready.png', name: 'GDPR Ready' },
];

export const REVIEW_SITES: Array<{ name: string; rating: string; href: string }> = [
  { name: 'Capterra', rating: '4.8', href: 'https://www.capterra.in/software/1059182/geta-ai' },
  { name: 'SoftwareSuggest', rating: '4.7', href: 'https://www.softwaresuggest.com/geta-ai' },
  { name: 'G2', rating: '4.6', href: 'https://www.g2.com/products/geta-ai' },
];
