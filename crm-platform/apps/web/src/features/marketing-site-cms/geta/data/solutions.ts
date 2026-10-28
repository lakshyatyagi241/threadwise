import type { IconName } from '../icons';
import type { Faq } from './products';

export interface Solution {
  slug: string;
  kind: 'industry' | 'usecase';
  name: string;
  short: string;
  icon: IconName;
  headline: string;
  sub: string;
  pains: Array<{ title: string; text: string }>;
  steps: Array<{ title: string; text: string }>;
  /** Product slugs this solution leans on. */
  products: string[];
  scenario: { title: string; lines: Array<{ from: 'customer' | 'business'; text: string }> };
  faq: Faq[];
}

export const INDUSTRIES: Solution[] = [
  {
    slug: 'healthcare',
    kind: 'industry',
    name: 'Healthcare',
    short: 'Appointments, reminders and patient follow-up.',
    icon: 'heart',
    headline: 'Fewer missed appointments. Calmer front desks.',
    sub: 'Clinics and hospitals use the platform to book visits, send reminders, share reports and answer routine questions without tying up the phone.',
    pains: [
      {
        title: 'No-shows cost revenue',
        text: 'Patients forget and slots go empty with no time to refill them.',
      },
      {
        title: 'Phones never stop ringing',
        text: 'Front-desk staff spend the day on timings, fees and directions.',
      },
      {
        title: 'Follow-up falls through',
        text: 'Post-visit care and repeat visits depend on someone remembering.',
      },
    ],
    steps: [
      {
        title: 'Capture the enquiry',
        text: 'Forms, QR codes at reception and click-to-chat links start a chat.',
      },
      { title: 'Book the slot', text: 'Offer times in chat and confirm the appointment.' },
      {
        title: 'Remind and prepare',
        text: 'Send reminders with directions and preparation instructions.',
      },
      { title: 'Follow up', text: 'Check in after the visit and prompt the next one.' },
    ],
    products: ['whatsapp', 'crm', 'chatbots-flows', 'team-inbox'],
    scenario: {
      title: 'Booking a consultation',
      lines: [
        { from: 'customer', text: 'Hi, I need to see a dermatologist this week.' },
        {
          from: 'business',
          text: 'Happy to help. Dr. Rao has Thursday 4:30 pm and Friday 11:00 am. Which suits you?',
        },
        { from: 'customer', text: 'Thursday please.' },
        { from: 'business', text: 'Booked. We will remind you the day before.' },
      ],
    },
    faq: [
      {
        q: 'Is patient data kept private?',
        a: 'Access is controlled by roles and each workspace is isolated from every other. Review our Security page for details and speak to us about your compliance needs.',
      },
      {
        q: 'Can the bot book appointments?',
        a: 'Yes. Flows and the appointment feature can offer slots and confirm a booking.',
      },
    ],
  },
  {
    slug: 'real-estate',
    kind: 'industry',
    name: 'Real Estate',
    short: 'Capture every enquiry and follow up fast.',
    icon: 'home',
    headline: 'Be first to reply to every property enquiry.',
    sub: 'Portal leads, ad clicks and walk-ins all arrive in one inbox, get an instant answer, and are assigned to the right agent with the property attached.',
    pains: [
      {
        title: 'Leads go cold in minutes',
        text: 'The agent who answers first usually wins the visit.',
      },
      {
        title: 'Leads scatter across tools',
        text: 'Portals, ads and calls land in different places.',
      },
      {
        title: 'Site visits are hard to coordinate',
        text: 'Scheduling by phone eats hours every week.',
      },
    ],
    steps: [
      {
        title: 'Capture from every source',
        text: 'Forms, links and ads create a contact with the listing recorded.',
      },
      { title: 'Reply instantly', text: 'A bot shares details and qualifies budget and area.' },
      {
        title: 'Assign and schedule',
        text: 'The right agent gets the lead and books the site visit.',
      },
      { title: 'Nurture the maybes', text: 'Campaigns keep new listings in front of warm leads.' },
    ],
    products: ['forms-lead-capture', 'ai-agents', 'crm', 'broadcasts-campaigns'],
    scenario: {
      title: 'A listing enquiry',
      lines: [
        { from: 'customer', text: 'Is the 3 BHK in Baner still available?' },
        { from: 'business', text: 'Yes. Budget range and preferred move-in date?' },
        { from: 'customer', text: '1.2 crore, next month.' },
        { from: 'business', text: 'Great fit. Priya will confirm a site visit time shortly.' },
      ],
    },
    faq: [
      {
        q: 'Can I see which portal a lead came from?',
        a: 'Yes. Source is recorded on every contact and available in reports and segments.',
      },
      {
        q: 'Can I split leads between agents?',
        a: 'Yes. Routing rules assign by area, team or round-robin.',
      },
    ],
  },
  {
    slug: 'education',
    kind: 'industry',
    name: 'Education',
    short: 'Admissions enquiries, counsellor follow-up and alerts.',
    icon: 'cap',
    headline: 'Turn admission enquiries into enrolments.',
    sub: 'Answer course and fee questions at any hour, qualify applicants, hand warm leads to counsellors and keep parents and students informed.',
    pains: [
      {
        title: 'Enquiry peaks overwhelm staff',
        text: 'Admission season brings more questions than a team can answer.',
      },
      {
        title: 'Counsellors chase cold lists',
        text: 'Without qualification, time goes to the wrong people.',
      },
      {
        title: 'Notices miss their audience',
        text: 'Deadlines and updates must reach thousands reliably.',
      },
    ],
    steps: [
      {
        title: 'Answer instantly',
        text: 'An agent trained on your prospectus replies day and night.',
      },
      {
        title: 'Qualify the applicant',
        text: 'Collect course interest, city and entrance details.',
      },
      {
        title: 'Hand to a counsellor',
        text: 'Warm leads reach the right counsellor with the full chat.',
      },
      { title: 'Keep everyone updated', text: 'Broadcast deadlines and events to segments.' },
    ],
    products: ['ai-agents', 'forms-lead-capture', 'broadcasts-campaigns', 'team-inbox'],
    scenario: {
      title: 'A fee enquiry at night',
      lines: [
        { from: 'customer', text: 'What is the fee for the MBA programme?' },
        {
          from: 'business',
          text: 'The MBA fee is listed in our prospectus. May I know your graduation year to share the right batch details?',
        },
        { from: 'customer', text: '2025.' },
        { from: 'business', text: 'Thanks. A counsellor will call you tomorrow at 10 am.' },
      ],
    },
    faq: [
      {
        q: 'Can the agent use our prospectus?',
        a: 'Yes. Upload the document and the agent answers from it.',
      },
      {
        q: 'Can I message parents and students separately?',
        a: 'Yes. Use tags or attributes to build separate segments.',
      },
    ],
  },
  {
    slug: 'ecommerce',
    kind: 'industry',
    name: 'E-commerce',
    short: 'Order updates, cart recovery and support.',
    icon: 'bag',
    headline: 'Sell, support and win back customers on WhatsApp.',
    sub: 'Connect your store to send order updates, recover abandoned carts, answer product questions and keep repeat customers coming back.',
    pains: [
      { title: 'Abandoned carts', text: 'Many shoppers leave at payment and never return.' },
      { title: '“Where is my order?”', text: 'Status questions flood support every day.' },
      { title: 'One-time buyers', text: 'Without follow-up, customers rarely buy twice.' },
    ],
    steps: [
      {
        title: 'Connect the store',
        text: 'Link Shopify or WooCommerce, or use the built-in storefront.',
      },
      {
        title: 'Automate updates',
        text: 'Confirmation, dispatch and delivery messages send themselves.',
      },
      { title: 'Recover and upsell', text: 'Cart reminders and offers go to the right segment.' },
      { title: 'Support in the same chat', text: 'Agents see the order beside the conversation.' },
    ],
    products: ['commerce', 'integrations-api', 'broadcasts-campaigns', 'whatsapp'],
    scenario: {
      title: 'Cart recovery',
      lines: [
        {
          from: 'business',
          text: 'You left 2 items in your cart. Complete your order here and we will hold them for 24 hours.',
        },
        { from: 'customer', text: 'Is cash on delivery possible?' },
        {
          from: 'business',
          text: 'Yes, it is available for your pincode. Want me to switch the order?',
        },
      ],
    },
    faq: [
      {
        q: 'Do I need Shopify?',
        a: 'No. Shopify and WooCommerce connections are optional; the catalog and storefront work independently.',
      },
      {
        q: 'Can customers pay in the chat?',
        a: 'You can send a payment link from your connected gateway account.',
      },
    ],
  },
  {
    slug: 'sales-teams',
    kind: 'industry',
    name: 'Sales Teams',
    short: 'Pipeline, follow-ups and outreach on one screen.',
    icon: 'target',
    headline: 'Run your pipeline from the conversation.',
    sub: 'Sales teams manage leads, deals, tasks and outreach in one workspace, so no reply, follow-up or renewal gets lost between tools.',
    pains: [
      {
        title: 'Context lives in people’s heads',
        text: 'Handovers lose the history of the conversation.',
      },
      { title: 'Follow-ups slip', text: 'Without reminders, warm deals go cold.' },
      {
        title: 'No view of the pipeline',
        text: 'Managers lack a live picture of what is closing.',
      },
    ],
    steps: [
      { title: 'Capture leads', text: 'Forms, ads and chats create contacts with their source.' },
      { title: 'Work the pipeline', text: 'Move deals across stages and assign tasks.' },
      { title: 'Reach out at scale', text: 'Send segmented campaigns and sequences.' },
      { title: 'Measure', text: 'Track response times and conversion by source and owner.' },
    ],
    products: ['crm', 'broadcasts-campaigns', 'team-inbox', 'integrations-api'],
    scenario: {
      title: 'A follow-up that does not slip',
      lines: [
        {
          from: 'business',
          text: 'Hi Arjun, here is the proposal we discussed. Shall we speak Friday?',
        },
        { from: 'customer', text: 'Friday 3 pm works.' },
        { from: 'business', text: 'Booked. I have also set a reminder on my side.' },
      ],
    },
    faq: [
      {
        q: 'Does it replace my CRM?',
        a: 'It can. It has contacts, companies, deals, tasks and reports, and can also sync with another CRM through the API.',
      },
      {
        q: 'Can managers see team performance?',
        a: 'Yes. Dashboards show response times, volumes and outcomes by team and person.',
      },
    ],
  },
];

export const USE_CASES: Solution[] = [
  {
    slug: 'lead-generation',
    kind: 'usecase',
    name: 'Lead Generation',
    short: 'Capture, qualify and route every new lead.',
    icon: 'target',
    headline: 'Capture more leads and stop losing the ones you have.',
    sub: 'Forms, links, QR codes and chat widgets bring leads in; an agent or flow qualifies them; routing puts them in front of the right person in seconds.',
    pains: [
      {
        title: 'Slow first response',
        text: 'Leads contacted within minutes convert far better than those contacted later.',
      },
      { title: 'Unqualified lists', text: 'Sales time goes to people who were never a fit.' },
      { title: 'No source visibility', text: 'You cannot improve what you cannot attribute.' },
    ],
    steps: [
      { title: 'Capture', text: 'Publish forms, links, QR codes and the website chat.' },
      { title: 'Qualify', text: 'Ask the key questions automatically.' },
      { title: 'Route', text: 'Assign hot leads to the right owner instantly.' },
      { title: 'Nurture', text: 'Keep the rest warm with campaigns.' },
    ],
    products: ['forms-lead-capture', 'ai-agents', 'crm', 'team-inbox'],
    scenario: {
      title: 'An ad lead, qualified in a minute',
      lines: [
        { from: 'customer', text: 'I clicked your ad. What are the plans?' },
        { from: 'business', text: 'Glad you did. Is this for yourself or a team?' },
        { from: 'customer', text: 'A team of 10.' },
        { from: 'business', text: 'Perfect. I am connecting you with Meera from our team now.' },
      ],
    },
    faq: [
      {
        q: 'Where do leads appear?',
        a: 'In the shared inbox and as contacts in the CRM, with source recorded.',
      },
      {
        q: 'Can I limit leads by region?',
        a: 'Yes. Routing rules can assign by tag, attribute or channel.',
      },
    ],
  },
  {
    slug: 'customer-support',
    kind: 'usecase',
    name: 'Customer Support',
    short: 'Answer faster with bots, routing and shared context.',
    icon: 'headset',
    headline: 'Support that answers fast and never repeats itself.',
    sub: 'Let bots resolve the routine, route the rest to the right team, and give agents the full context so customers never repeat their story.',
    pains: [
      { title: 'Long wait times', text: 'Queues build when every question needs a person.' },
      { title: 'Repeated explanations', text: 'Customers tell the same story to every agent.' },
      {
        title: 'No visibility into SLAs',
        text: 'Missed targets surface only when a customer complains.',
      },
    ],
    steps: [
      { title: 'Deflect the routine', text: 'Bots and agents answer common questions.' },
      { title: 'Route the rest', text: 'Rules send chats to the right team.' },
      { title: 'Resolve with context', text: 'Agents see history and notes.' },
      { title: 'Measure and improve', text: 'Track response and resolution times.' },
    ],
    products: ['team-inbox', 'ai-agents', 'chatbots-flows', 'email'],
    scenario: {
      title: 'Order status, resolved by the bot',
      lines: [
        { from: 'customer', text: 'Where is my order #4821?' },
        {
          from: 'business',
          text: 'It shipped yesterday and is due Thursday. Here is the tracking link.',
        },
        { from: 'customer', text: 'Thanks!' },
      ],
    },
    faq: [
      {
        q: 'Can customers reach a human?',
        a: 'Yes. Handover rules or a keyword move the chat to an agent.',
      },
      {
        q: 'Which channels are supported?',
        a: 'WhatsApp, Instagram, Facebook, Telegram and your website chat.',
      },
    ],
  },
  {
    slug: 'whatsapp-marketing',
    kind: 'usecase',
    name: 'WhatsApp Marketing',
    short: 'Broadcasts and campaigns with real results.',
    icon: 'megaphone',
    headline: 'Marketing messages people open.',
    sub: 'Build segments, send approved templates and multi-step campaigns, and see who read and replied, all on the official WhatsApp API.',
    pains: [
      { title: 'Low email engagement', text: 'Inboxes are crowded and open rates are falling.' },
      { title: 'Compliance worries', text: 'Opt-in and template rules are easy to get wrong.' },
      { title: 'No way to measure', text: 'Without reports you cannot tell what worked.' },
    ],
    steps: [
      { title: 'Collect opt-ins', text: 'Forms and links record consent.' },
      { title: 'Build the audience', text: 'Segment by behaviour and attributes.' },
      { title: 'Send and sequence', text: 'Broadcast or run a multi-step campaign.' },
      { title: 'Measure', text: 'Review delivery, read and reply rates.' },
    ],
    products: ['whatsapp', 'broadcasts-campaigns', 'forms-lead-capture', 'crm'],
    scenario: {
      title: 'A festive offer broadcast',
      lines: [
        {
          from: 'business',
          text: 'Our festive sale starts tomorrow. Early access for you: 20% off with code EARLY20.',
        },
        { from: 'customer', text: 'Does it include the new range?' },
        { from: 'business', text: 'Yes, everything except gift cards.' },
      ],
    },
    faq: [
      {
        q: 'Do I need template approval?',
        a: 'Business-initiated messages use templates that WhatsApp approves. You manage them in the platform.',
      },
      { q: 'Can I schedule sends?', a: 'Yes. Schedule ahead and the queue paces delivery.' },
    ],
  },
  {
    slug: 'appointment-booking',
    kind: 'usecase',
    name: 'Appointment Booking',
    short: 'Let customers book, confirm and reschedule in chat.',
    icon: 'calendar',
    headline: 'Bookings that fill themselves.',
    sub: 'Offer slots in chat, confirm instantly and send reminders so people show up, without back-and-forth messages.',
    pains: [
      { title: 'Back-and-forth scheduling', text: 'Finding a time takes many messages.' },
      { title: 'No-shows', text: 'Empty slots cost money.' },
      { title: 'Manual reminders', text: 'Staff spend time on calls and texts.' },
    ],
    steps: [
      { title: 'Offer availability', text: 'Share open slots in the conversation.' },
      { title: 'Confirm', text: 'The booking is saved and tied to the contact.' },
      { title: 'Remind', text: 'Automatic reminders reduce no-shows.' },
      { title: 'Reschedule', text: 'Customers change the slot in the same chat.' },
    ],
    products: ['crm', 'whatsapp', 'chatbots-flows', 'team-inbox'],
    scenario: {
      title: 'Rescheduling without a call',
      lines: [
        {
          from: 'business',
          text: 'Reminder: your visit is tomorrow at 11 am. Reply 1 to confirm or 2 to reschedule.',
        },
        { from: 'customer', text: '2' },
        { from: 'business', text: 'No problem. Available: Fri 10 am, Fri 3 pm.' },
      ],
    },
    faq: [
      {
        q: 'Can I send reminders automatically?',
        a: 'Yes. Reminders are sent on a schedule before each appointment.',
      },
      {
        q: 'Can staff manage the calendar?',
        a: 'Yes. Appointments are visible to the team with owners.',
      },
    ],
  },
  {
    slug: 'order-updates',
    kind: 'usecase',
    name: 'Order & Payment Updates',
    short: 'Confirmations, shipping and payment reminders.',
    icon: 'card',
    headline: 'Keep customers informed without lifting a finger.',
    sub: 'Trigger order confirmations, dispatch notices, payment links and reminders from your store or API, and answer the follow-up questions in the inbox.',
    pains: [
      { title: 'Status questions', text: 'Customers ask where their order is.' },
      { title: 'Late payments', text: 'Invoices go unpaid without a nudge.' },
      { title: 'Manual updates', text: 'Staff copy order data into messages by hand.' },
    ],
    steps: [
      { title: 'Connect the source', text: 'Store, API or webhook sends the event.' },
      { title: 'Pick the template', text: 'Map order fields to message variables.' },
      { title: 'Send automatically', text: 'Messages go out on each status change.' },
      { title: 'Handle replies', text: 'Questions arrive in the inbox with context.' },
    ],
    products: ['commerce', 'integrations-api', 'whatsapp', 'team-inbox'],
    scenario: {
      title: 'A dispatch notice',
      lines: [
        {
          from: 'business',
          text: 'Your order #4821 has shipped. Track it here. Expected delivery: Thursday.',
        },
        { from: 'customer', text: 'Can I change the address?' },
        {
          from: 'business',
          text: 'I have flagged it with our team; you will hear back within the hour.',
        },
      ],
    },
    faq: [
      {
        q: 'Can I trigger messages from my own system?',
        a: 'Yes. Use the REST API or webhooks to send template messages on any event.',
      },
      { q: 'Are payment links supported?', a: 'Yes, through your own payment gateway account.' },
    ],
  },
];

export const ALL_SOLUTIONS = [...INDUSTRIES, ...USE_CASES];
export const solutionBySlug = (kind: Solution['kind'], slug: string) =>
  ALL_SOLUTIONS.find((s) => s.kind === kind && s.slug === slug);
