import type { IconName } from '../icons';

/**
 * The kinds of business the site speaks to. One list feeds the hero artwork, the pick-your-business panel and the niche
 * pages, so the words and examples never drift apart. Every name and message is made up. `on` is what that business turns on
 * (no fixed packages: it is a starting point), `off` is what it can ignore.
 */
export interface NicheCard {
  icon: IconName;
  t: string;
  d: string;
}

export interface Niche {
  id: string;
  /** Long label for chips. */
  label: string;
  /** Short industry name shown on the artwork. */
  industry: string;
  /** The word that ends the home headline: "One platform, built around your ...". */
  phrase: string;
  /** What this business calls the person it serves. */
  who: string;
  icon: IconName;
  href: string;
  headline: string;
  blurb: string;
  on: string[];
  off: string[];
  chat: Array<{ from: 'in' | 'out'; text: string }>;
  /** Small outcome cards beside the chat. */
  cards: NicheCard[];
  hero: { initials: string; name: string; sub: string; cards: NicheCard[] };
}

export const NICHES: Niche[] = [
  {
    id: 'clinic',
    label: 'Clinic or hospital',
    industry: 'Clinic',
    phrase: 'clinic',
    who: 'Patient',
    icon: 'heart',
    href: '/solutions/healthcare',
    headline: 'Your Geta for a clinic',
    blurb:
      'Keep patients, book appointments and send reminders and follow-ups. Nothing else gets in the way.',
    on: ['Patient list', 'Appointment booking', 'Reminders and follow-ups', 'WhatsApp booking'],
    off: ['Deals', 'Invoices', 'Online store'],
    chat: [
      { from: 'in', text: 'Can I see Dr. Rao on Saturday?' },
      { from: 'out', text: 'Yes, 11:00 AM is free. Shall I book it?' },
      { from: 'in', text: 'Please do.' },
    ],
    cards: [
      { icon: 'calendar', t: 'Appointment booked', d: 'Sat · 11:00 AM · Dr. Rao' },
      { icon: 'bell', t: 'Reminder queued', d: 'Sent the day before' },
      { icon: 'check', t: 'Follow-up set', d: 'Check-in after 7 days' },
    ],
    hero: {
      initials: 'PN',
      name: 'Priya Nair',
      sub: 'Check-up booked for Saturday',
      cards: [
        { icon: 'whatsapp', t: 'WhatsApp booking', d: '“Can I book for Saturday?”' },
        { icon: 'calendar', t: 'Appointment', d: 'Sat · 11:00 AM' },
        { icon: 'form', t: 'New patient form', d: 'Filled in on the website' },
        { icon: 'bell', t: 'Reminder', d: 'Sent the day before' },
        { icon: 'check', t: 'Follow-up', d: 'Check-in after 7 days' },
        { icon: 'chat', t: 'Shared inbox', d: 'Front desk replies here' },
      ],
    },
  },
  {
    id: 'school',
    label: 'School or kindergarten',
    industry: 'School',
    phrase: 'school',
    who: 'Parent',
    icon: 'cap',
    href: '/solutions/education',
    headline: 'Your Geta for a school',
    blurb:
      'A small assistant on your website or WhatsApp answers parents, sends the brochure and keeps every enquiry.',
    on: [
      'Website or WhatsApp assistant',
      'Brochures and programs',
      'Enquiry list',
      'Small campaigns',
    ],
    off: ['Deals', 'Invoices', 'Appointments'],
    chat: [
      { from: 'in', text: 'What are the nursery fees?' },
      { from: 'out', text: 'I have sent the brochure with fees and timings.' },
      { from: 'in', text: 'Can we visit this week?' },
    ],
    cards: [
      { icon: 'doc', t: 'Brochure sent', d: 'Fees and timings' },
      { icon: 'contact', t: 'Enquiry saved', d: 'Added to your list' },
      { icon: 'megaphone', t: 'Open day invite', d: 'Sent to 120 parents' },
    ],
    hero: {
      initials: 'AM',
      name: 'Anita Menon',
      sub: 'Asked about nursery admission',
      cards: [
        { icon: 'widget', t: 'Website chat', d: '“What are the fees?”' },
        { icon: 'doc', t: 'Brochure', d: 'Sent automatically' },
        { icon: 'contact', t: 'Enquiry saved', d: 'Added to your list' },
        { icon: 'megaphone', t: 'Open day', d: 'Invite sent to 120 parents' },
        { icon: 'flow', t: 'Follow-up', d: 'Message after 2 days' },
        { icon: 'chat', t: 'Shared inbox', d: 'Staff take over' },
      ],
    },
  },
  {
    id: 'university',
    label: 'University or college',
    industry: 'University',
    phrase: 'university',
    who: 'Student',
    icon: 'book',
    href: '/solutions/universities',
    headline: 'Your Geta for a university',
    blurb:
      'Answer every admission question at any hour, route serious applicants to a counsellor and keep students informed.',
    on: [
      'Admission enquiry assistant',
      'Counsellor assignment',
      'Broadcasts to batches',
      'Personalised follow-ups',
    ],
    off: ['Online store', 'Invoices'],
    chat: [
      { from: 'in', text: 'Is the MBA still open for this year?' },
      { from: 'out', text: 'Yes. Which specialisation interests you?' },
      { from: 'in', text: 'Marketing.' },
    ],
    cards: [
      { icon: 'users', t: 'Assigned to a counsellor', d: 'Marketing, MBA' },
      { icon: 'form', t: 'Application link sent', d: 'Deadline 30 June' },
      { icon: 'megaphone', t: 'Open day reminder', d: 'Sent to 1,200 enquirers' },
    ],
    hero: {
      initials: 'RS',
      name: 'Rohan Shah',
      sub: 'Enquired about the MBA',
      cards: [
        { icon: 'widget', t: 'Website chat', d: '“Is the MBA still open?”' },
        { icon: 'form', t: 'Application link', d: 'Sent in the chat' },
        { icon: 'users', t: 'Counsellor', d: 'Assigned to Meera' },
        { icon: 'megaphone', t: 'Open day', d: 'Invite to 1,200 enquirers' },
        { icon: 'flow', t: 'Follow-up', d: 'Deadline reminder' },
        { icon: 'chart', t: 'Results', d: 'Enquiries by programme' },
      ],
    },
  },
  {
    id: 'store',
    label: 'Online store',
    industry: 'Online store',
    phrase: 'online store',
    who: 'Customer',
    icon: 'bag',
    href: '/solutions/ecommerce',
    headline: 'Your Geta for a store',
    blurb: 'Connect your Shopify or WooCommerce store and let order events send the right message.',
    on: ['Shopify or WooCommerce', 'Abandoned-cart flow', 'Order updates', 'Offers to customers'],
    off: ['Deals', 'Appointments'],
    chat: [
      { from: 'out', text: 'You left 2 items in your cart. Complete your order here.' },
      { from: 'in', text: 'Can I change the size?' },
      { from: 'out', text: 'Sure, which size would you like?' },
    ],
    cards: [
      { icon: 'flow', t: 'Abandoned cart', d: 'Reminder sent in 1 hour' },
      { icon: 'whatsapp', t: 'Order update', d: 'Shipped, tracking link' },
      { icon: 'megaphone', t: 'Offer', d: 'Sent to repeat buyers' },
    ],
    hero: {
      initials: 'NB',
      name: 'Neha Banerjee',
      sub: 'Left 2 items in her cart',
      cards: [
        { icon: 'bag', t: 'Store connected', d: 'Orders flow in' },
        { icon: 'flow', t: 'Abandoned cart', d: 'Reminder in 1 hour' },
        { icon: 'whatsapp', t: 'Order update', d: 'Shipped, tracking link' },
        { icon: 'megaphone', t: 'Offer', d: 'Sent to repeat buyers' },
        { icon: 'chat', t: 'Support chat', d: '“Can I change the size?”' },
        { icon: 'chart', t: 'Results', d: 'Read and reply rates' },
      ],
    },
  },
  {
    id: 'travel',
    label: 'Travel or hospitality',
    industry: 'Travel & hotels',
    phrase: 'travel agency',
    who: 'Guest',
    icon: 'globe',
    href: '/solutions/travel-hospitality',
    headline: 'Your Geta for travel and hotels',
    blurb:
      'Reply to every enquiry at once, send quotes, confirm bookings and ask for reviews after the stay.',
    on: ['Enquiry capture', 'Quotes and itineraries', 'Booking confirmations', 'Payment reminders'],
    off: ['Online store', 'Appointments'],
    chat: [
      { from: 'in', text: 'Do you have a 3-night Goa package for 4?' },
      { from: 'out', text: 'Yes. I have sent a quote with two hotel options.' },
      { from: 'in', text: 'The second one, please.' },
    ],
    cards: [
      { icon: 'doc', t: 'Quote sent', d: 'Goa · 3 nights · 4 guests' },
      { icon: 'card', t: 'Payment reminder', d: 'Advance due Friday' },
      { icon: 'chat', t: 'Review request', d: 'Sent after check-out' },
    ],
    hero: {
      initials: 'KD',
      name: 'Karan Desai',
      sub: 'Asked for a Goa package',
      cards: [
        { icon: 'whatsapp', t: 'WhatsApp enquiry', d: '“3 nights in Goa for 4?”' },
        { icon: 'doc', t: 'Quote', d: 'Two hotel options sent' },
        { icon: 'card', t: 'Payment', d: 'Advance reminder' },
        { icon: 'calendar', t: 'Booking', d: 'Confirmed for 12 June' },
        { icon: 'bell', t: 'Pre-trip tips', d: 'Sent 2 days before' },
        { icon: 'check', t: 'Review', d: 'Asked after check-out' },
      ],
    },
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing or B2B',
    industry: 'Manufacturer',
    phrase: 'factory',
    who: 'Buyer',
    icon: 'cog',
    href: '/solutions/manufacturing',
    headline: 'Your Geta for a manufacturer',
    blurb:
      'Capture every bulk enquiry, send a quote, follow up until the order lands and keep dealers informed.',
    on: ['Enquiry forms', 'Quotes and deals', 'Follow-up tasks', 'Dealer broadcasts'],
    off: ['Appointments', 'Online store'],
    chat: [
      { from: 'in', text: 'Need a quote for 500 units of the 12 mm bolt.' },
      { from: 'out', text: 'Sent. Delivery in 10 days. Shall I hold the price?' },
      { from: 'in', text: 'Yes, until Friday.' },
    ],
    cards: [
      { icon: 'doc', t: 'Quote sent', d: '500 units · 10 days' },
      { icon: 'kanban', t: 'Deal created', d: 'Stage: Quoted' },
      { icon: 'check', t: 'Follow-up task', d: 'Call on Friday' },
    ],
    hero: {
      initials: 'VP',
      name: 'Vishal Patil',
      sub: 'Asked for a bulk quote',
      cards: [
        { icon: 'form', t: 'Enquiry form', d: '500 units, 12 mm bolt' },
        { icon: 'doc', t: 'Quote', d: 'Sent in the chat' },
        { icon: 'kanban', t: 'Deal', d: 'Moved to Quoted' },
        { icon: 'check', t: 'Task', d: 'Call back on Friday' },
        { icon: 'megaphone', t: 'Dealer update', d: 'New price list sent' },
        { icon: 'card', t: 'Invoice', d: 'Raised on order' },
      ],
    },
  },
  {
    id: 'realestate',
    label: 'Real estate',
    industry: 'Real estate',
    phrase: 'real estate team',
    who: 'Buyer',
    icon: 'home',
    href: '/solutions/real-estate',
    headline: 'Your Geta for real estate',
    blurb: 'Capture every enquiry, qualify it on WhatsApp, book the site visit and track the deal.',
    on: [
      'Enquiry forms and links',
      'WhatsApp qualification',
      'Site-visit booking',
      'Deals pipeline',
    ],
    off: ['Online store', 'Invoices'],
    chat: [
      { from: 'in', text: 'Is the 3 BHK in Baner still available?' },
      { from: 'out', text: 'Yes. What budget and move-in date should I note?' },
      { from: 'in', text: 'Around ₹1.2 crore, next month.' },
    ],
    cards: [
      { icon: 'target', t: 'Lead qualified', d: '₹1.2 crore · next month' },
      { icon: 'calendar', t: 'Site visit booked', d: 'Saturday · 11:00 AM' },
      { icon: 'kanban', t: 'Deal opened', d: 'Stage: Qualified' },
    ],
    hero: {
      initials: 'AM',
      name: 'Aarav Mehta',
      sub: 'Asked about a 3 BHK in Baner',
      cards: [
        { icon: 'form', t: 'Enquiry form', d: 'From the listing page' },
        { icon: 'whatsapp', t: 'WhatsApp', d: 'Budget and timeline asked' },
        { icon: 'calendar', t: 'Site visit', d: 'Sat · 11:00 AM' },
        { icon: 'kanban', t: 'Deal', d: 'Moved to Qualified' },
        { icon: 'users', t: 'Assigned', d: 'To Riya Kapoor' },
        { icon: 'megaphone', t: 'New launch', d: 'Update sent to buyers' },
      ],
    },
  },
  {
    id: 'agency',
    label: 'Agency or service business',
    industry: 'Agency',
    phrase: 'agency',
    who: 'Client',
    icon: 'users',
    href: '/solutions/sales-teams',
    headline: 'Your Geta for an agency',
    blurb:
      'Run the whole lifecycle: leads, deals, estimates, invoices and follow-ups, with your team in one inbox.',
    on: [
      'Contacts and deals',
      'Estimates and invoices',
      'Tasks and follow-ups',
      'Shared team inbox',
    ],
    off: ['Online store', 'Appointments'],
    chat: [
      { from: 'out', text: 'Hi Arjun, here is the proposal we discussed.' },
      { from: 'in', text: 'Thanks, we will review it by Friday.' },
      { from: 'out', text: 'Great. I have set a reminder to follow up.' },
    ],
    cards: [
      { icon: 'kanban', t: 'Deal moved', d: 'Stage: Proposal' },
      { icon: 'doc', t: 'Estimate sent', d: '₹2.4 lakh · retainer' },
      { icon: 'card', t: 'Invoice raised', d: 'Due on the 15th' },
    ],
    hero: {
      initials: 'NA',
      name: 'Northwind Agency',
      sub: 'Proposal sent, awaiting reply',
      cards: [
        { icon: 'kanban', t: 'Deal', d: 'Moved to Proposal' },
        { icon: 'doc', t: 'Estimate', d: 'Sent for approval' },
        { icon: 'card', t: 'Invoice', d: 'Due on the 15th' },
        { icon: 'check', t: 'Task', d: 'Call back on Friday' },
        { icon: 'chat', t: 'Team inbox', d: 'Assigned to Riya' },
        { icon: 'mail', t: 'Email', d: 'Thread kept in one place' },
      ],
    },
  },
];
