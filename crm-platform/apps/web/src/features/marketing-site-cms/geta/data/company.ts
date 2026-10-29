import type { IconName } from '../icons';

/**
 * What the About and Careers pages say about the company. Carried over from the previous geta.ai site, minus its customer
 * counts, so nothing here is a number that has to be kept true by hand.
 */

export const COMPANY_FACTS: Array<{ label: string; value: string }> = [
  { label: 'Company', value: 'Geta AI Labs Pvt Ltd' },
  { label: 'Founded', value: '2023' },
  { label: 'Based in', value: 'Pune, India' },
];

export const MISSION =
  'Most businesses run customer engagement like it is 2015: disconnected tools, manual follow-ups and messages that go to everyone instead of the right person at the right moment. We built Geta.ai to fix that.';

export const PRINCIPLES: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'heart',
    title: 'Customer obsession',
    text: 'Every product decision starts with one question: does this make our customers more successful? We measure ourselves by their outcomes, not our feature list.',
  },
  {
    icon: 'bolt',
    title: 'Speed and simplicity',
    text: 'Complexity is the enemy of adoption. We build powerful systems that feel effortless, and we count it a miss when a team cannot go live in an afternoon.',
  },
  {
    icon: 'chart',
    title: 'Measurable impact',
    text: 'Every feature ships with one test: does it lower the cost of winning a customer, improve conversion or bring in more revenue? If the answer is not clear, it goes back.',
  },
];

export const MILESTONES: Array<{ year: string; text: string }> = [
  {
    year: '2023',
    text: 'Founded in Pune as Geta AI Labs. The first customers were schools and colleges, followed quickly by real estate teams. The engagement CRM was built and launched.',
  },
  {
    year: '2024',
    text: 'The WhatsApp API went live. AI agents and journey orchestration shipped, along with the shared inbox and website forms.',
  },
  {
    year: '2025',
    text: 'The voice AI agent launched. The platform grew into healthcare, finance and events, with deeper segmentation and smarter automation triggers.',
  },
  {
    year: '2026',
    text: 'Multi-language AI agents rolled out, with deeper WhatsApp Cloud API integration and real-time lead scoring.',
  },
];

export interface Person {
  name: string;
  title: string;
  photo: string;
  bio: string;
}

export const LEADER: Person & { also: string } = {
  name: 'Dr. Vikram Kumar',
  title: 'Managing Director',
  also: 'Founder and MD of Geta AI Labs and SRV Media. Co-founder of Easebuzz.',
  photo: '/geta/team/dr-vikram-kumar.jpg',
  bio: 'Vikram founded SRV Media, an ISO-certified digital marketing agency, in 2011, and Geta AI Labs after it. He holds a Ph.D. from Symbiosis International (Deemed University) and an MBA in IT, previously led IT projects at HDFC Bank, and co-founded the fintech payments platform Easebuzz. He has more than twenty years of experience in digital growth and technology.',
};

export const TEAM: Person[] = [
  {
    name: 'Shubham Puranik',
    title: 'Director and Head of Product Management',
    photo: '/geta/team/shubham-puranik.jpg',
    bio: 'Leads product vision and direction across the platform.',
  },
  {
    name: 'Ketan Ghumatkar',
    title: 'Engineering Head',
    photo: '/geta/team/ketan-ghumatkar.jpg',
    bio: 'Leads the engineering team behind the core platform, with deep experience in scalable systems and real-time data.',
  },
  {
    name: 'Hrushikesh Udawant',
    title: 'Sales and Marketing Head',
    photo: '/geta/team/hrushikesh-udawant.jpg',
    bio: 'Leads sales and marketing and builds the go-to-market plan.',
  },
  {
    name: 'Sumeet Bhise',
    title: 'Customer Success Head',
    photo: '/geta/team/sumeet-bhise.jpg',
    bio: 'Makes sure every business on the platform gets real, measurable results.',
  },
  {
    name: 'Prasad Chaudhari',
    title: 'Engineering Manager',
    photo: '/geta/team/prasad-chaudhari.jpg',
    bio: 'Manages the engineering teams that deliver robust, scalable features.',
  },
  {
    name: 'Lakshya Tyagi',
    title: 'Engineering Manager',
    photo: '/geta/team/lakshya-tyagi.jpg',
    bio: 'Leads engineering squads focused on product quality, speed and delivery for customers.',
  },
  {
    name: 'Sumeet Kamble',
    title: 'Senior Software Developer',
    photo: '/geta/team/sumeet-kamble.jpg',
    bio: 'Builds and maintains core platform features.',
  },
  {
    name: 'Paridhi Agrawal',
    title: 'QA Lead',
    photo: '/geta/team/paridhi-agrawal.jpg',
    bio: 'Keeps the platform reliable through rigorous testing and quality processes.',
  },
];

export const ADVISORS: Person[] = [
  {
    name: 'Dr. Ramakrishnan Raman',
    title: 'Vice Chancellor, Symbiosis International (Deemed University)',
    photo: '/geta/team/dr-ramakrishnan-raman.jpg',
    bio: 'Has built a career across the corporate, academic and research worlds. His consulting on ERP implementation and his research in AI and IT strategy make him a trusted adviser to emerging technology companies.',
  },
  {
    name: 'Krishna Kumar',
    title: 'Engineering leader and adviser',
    photo: '/geta/team/krishna-kumar.jpg',
    bio: 'An IIT Kharagpur alumnus with more than twenty years of scaling engineering organisations, including senior roles at Oracle Cloud Infrastructure and AWS. Advises on platform architecture, AI adoption and growing engineering teams.',
  },
];

export const WHY_JOIN: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'bolt',
    title: 'High-impact work from day one',
    text: 'Every team member ships features that reach real customers. No busywork, and no waiting for approval on small decisions.',
  },
  {
    icon: 'users',
    title: 'Collaborative by default',
    text: 'A flat structure and a clear roadmap, in a culture where the best idea wins wherever it comes from.',
  },
  {
    icon: 'globe',
    title: 'Remote-friendly',
    text: 'We hire good people wherever they are, with an async-first way of working and regular team syncs.',
  },
  {
    icon: 'layers',
    title: 'Hard problems worth solving',
    text: 'Real-time messaging at scale, AI agents and multi-channel orchestration are genuinely interesting technical challenges.',
  },
  {
    icon: 'chat',
    title: 'Customer-obsessed culture',
    text: 'Everyone, from engineering to sales, talks to customers. We build what people actually need.',
  },
];

export const CAREERS_EMAIL = 'careers@geta.ai';
