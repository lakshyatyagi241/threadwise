import type { IconName } from '../icons';
import type { PortraitLook } from '../portrait';
import type { Faq } from './products';
import { SOCIAL_EXTRAS } from './channel-extras-social';

/**
 * What the channel pages add to the shared product copy: the animated chat in the hero, the "in practice" scenes and the
 * extra questions. Every conversation is made up, and each scene sticks to what the channel does in the product (SMS is
 * send-only, calling is WhatsApp calling by people, Instagram and Messenger reach only people who wrote first).
 */
export interface ChatLine {
  /** `event` is a small centred note such as "Call · 4 min". */
  from: 'customer' | 'business' | 'event';
  text: string;
}

export interface PracticeScene {
  /** The kind of business, shown small above the title. */
  tag: string;
  title: string;
  icon: IconName;
  summary: string;
  lines: ChatLine[];
  outcomes: string[];
}

export interface ChannelExtra {
  /** The channel's own tint, used for bubbles, chips and highlights. */
  hue: string;
  /** The channel only sends: no customer replies are received, so no typing dots and no "message path". */
  sendOnly?: boolean;
  /** Who is on the other end of the sample chat. */
  contact: { name: string; look: PortraitLook; status: string };
  /** The conversation that loops in the hero. */
  chat: ChatLine[];
  /** Three small cards that appear around the phone as the chat goes on. */
  floats: Array<{ icon: IconName; t: string; d: string }>;
  practice: PracticeScene[];
  /** Added after the page's own questions, to bring the list to six. */
  faq: Faq[];
}

const WHATSAPP: ChannelExtra = {
  hue: '#16a34a',
  contact: { name: 'Priya Nair', look: 'sweep', status: 'online' },
  chat: [
    {
      from: 'business',
      text: 'Hello Priya, a reminder of your visit with Dr. Rao tomorrow at 11:00 AM.',
    },
    { from: 'customer', text: 'Can I come at 12 instead?' },
    { from: 'business', text: 'Of course. 12:00 PM is free. Shall I move it?' },
    { from: 'customer', text: 'Yes please.' },
    { from: 'business', text: 'Done. You are booked for 12:00 PM tomorrow.' },
  ],
  floats: [
    { icon: 'template', t: 'Template approved', d: 'Appointment reminder' },
    { icon: 'check', t: 'Delivered and read', d: 'Status on every message' },
    { icon: 'users', t: 'Assigned to Riya', d: 'Front desk' },
  ],
  practice: [
    {
      tag: 'Clinics',
      title: 'Appointment reminders people read',
      icon: 'calendar',
      summary:
        'An approved template goes out the day before, and the patient answers in the same chat.',
      lines: [
        {
          from: 'business',
          text: 'Hello Priya, a reminder of your visit with Dr. Rao tomorrow at 11:00 AM.',
        },
        { from: 'customer', text: 'Can I come at 12 instead?' },
        { from: 'business', text: 'Of course. 12:00 PM is free. Shall I move it?' },
        { from: 'customer', text: 'Yes please.' },
        { from: 'business', text: 'Done. You are booked for 12:00 PM tomorrow.' },
      ],
      outcomes: [
        'The reminder goes out from an approved template',
        'The reply lands in the shared inbox',
        'The booking is updated on the contact',
      ],
    },
    {
      tag: 'Real estate',
      title: 'Site visits from a QR code',
      icon: 'qr',
      summary:
        'A QR code on a hoarding opens a chat with the message already typed, and the enquiry turns into a visit.',
      lines: [
        {
          from: 'customer',
          text: 'Hi, I scanned the QR on the hoarding. Is the 3 BHK still available?',
        },
        { from: 'business', text: 'Yes, it is. Which budget range are you looking at?' },
        { from: 'customer', text: 'Around 1.2 crore.' },
        {
          from: 'business',
          text: 'That works. I can book a site visit this Saturday, 11 AM or 4 PM?',
        },
        { from: 'customer', text: '4 PM.' },
      ],
      outcomes: [
        'A click-to-chat link or QR code opens the chat with the message filled in',
        'The source is saved on the contact',
        'A visit is booked and a task is set for the agent',
      ],
    },
    {
      tag: 'Education',
      title: 'Admission updates to a whole batch',
      icon: 'megaphone',
      summary:
        'One approved template reaches a saved segment, and every reply goes to the right counsellor.',
      lines: [
        {
          from: 'business',
          text: 'Admissions for the MBA close on 30 June. Apply here and we will guide you.',
        },
        { from: 'customer', text: 'Is there an education loan option?' },
        {
          from: 'business',
          text: 'Yes. A counsellor will call you tomorrow at 10 AM to walk you through it.',
        },
        { from: 'customer', text: 'Thank you, I will be free then.' },
      ],
      outcomes: [
        'One template is sent to a saved segment',
        'Replies are routed to counsellors',
        'Sent, delivered and read are tracked for every message',
      ],
    },
    {
      tag: 'E-commerce',
      title: 'Order updates that also take questions',
      icon: 'bag',
      summary:
        'Shipping messages go out on their own, and customers answer in the same thread instead of calling.',
      lines: [
        {
          from: 'business',
          text: 'Your order #4821 has shipped and should reach you by Thursday.',
        },
        { from: 'customer', text: 'Can I change the delivery address?' },
        {
          from: 'business',
          text: 'I have passed this to our team. They will confirm within the hour.',
        },
        { from: 'event', text: 'Assigned to Karan · Support' },
        { from: 'business', text: 'Hi, this is Karan. The address is updated to your office.' },
      ],
      outcomes: [
        'Status messages go out as templates',
        'The customer replies in the same thread',
        'Anything the agent cannot handle goes to a person',
      ],
    },
    {
      tag: 'Events',
      title: 'Registrations and reminders',
      icon: 'form',
      summary:
        'A registration is confirmed in chat, and a reminder arrives an hour before the event starts.',
      lines: [
        { from: 'customer', text: 'I would like to register for Friday’s webinar.' },
        {
          from: 'business',
          text: 'Done. You are registered for Friday, 5 PM. I will remind you an hour before.',
        },
        { from: 'event', text: 'Reminder sent · Friday 4:00 PM' },
        { from: 'business', text: 'Starting in an hour. Here is your joining link.' },
      ],
      outcomes: [
        'The registration is saved with the contact',
        'The reminder is scheduled and sent on time',
        'Who read it is visible afterwards',
      ],
    },
    {
      tag: 'Sales teams',
      title: 'Quotes and follow-ups that stay in one thread',
      icon: 'doc',
      summary:
        'The quote, the questions and the call to close all sit in one conversation, saved on the deal.',
      lines: [
        { from: 'customer', text: 'Please send the quote for 20 seats.' },
        {
          from: 'business',
          text: 'Sent. It is valid till Friday. Would you like a call to go through it?',
        },
        { from: 'customer', text: 'Yes, tomorrow at 3.' },
        { from: 'event', text: 'Task created · Call, tomorrow 3:00 PM' },
        { from: 'business', text: 'Booked. Talk to you tomorrow at 3.' },
      ],
      outcomes: [
        'The conversation is saved on the contact record',
        'A call task is created for the owner',
        'A follow-up goes out if the customer goes quiet',
      ],
    },
  ],
  faq: [
    {
      q: 'How is this different from the WhatsApp Business app?',
      a: 'The Business app lives on one phone. Here your whole team shares one number in an inbox, with templates, campaigns, flows, AI agents and a CRM on top, connected through the official WhatsApp Business platform.',
    },
    {
      q: 'Can an AI agent answer on WhatsApp?',
      a: 'Yes. An agent trained on your own content can answer, collect details and hand the chat to a person in the team inbox when it should.',
    },
    {
      q: 'Can I send campaigns to many people at once?',
      a: 'Yes. Send an approved template to a saved segment from broadcasts and campaigns, and see sent, delivered and read for each. Only message people who have agreed to hear from you.',
    },
  ],
};

const EMAIL: ChannelExtra = {
  hue: '#4f46e5',
  contact: { name: 'Rohan Shah', look: 'crop', status: 'support@ mailbox' },
  chat: [
    { from: 'customer', text: 'Hi, my last invoice shows the wrong GST number. Can you fix it?' },
    {
      from: 'business',
      text: 'Sorry about that. I have the invoice open. Could you share the correct number?',
    },
    { from: 'customer', text: 'It is in the attached file.' },
    { from: 'business', text: 'Thank you. A corrected invoice is on its way to you now.' },
  ],
  floats: [
    { icon: 'inbox', t: 'Assigned to Billing', d: 'Shared support@ mailbox' },
    { icon: 'template', t: 'Template inserted', d: 'Corrected invoice' },
    { icon: 'timeline', t: 'WhatsApp history', d: 'Same contact, one timeline' },
  ],
  practice: [
    {
      tag: 'Finance and billing',
      title: 'Billing questions, answered once',
      icon: 'card',
      summary:
        'An invoice query arrives at support@, goes to the billing team and is answered from a template filled in for that customer.',
      lines: [
        { from: 'customer', text: 'The billing name on my invoice is wrong. Can you reissue it?' },
        { from: 'event', text: 'Assigned to Billing · support@' },
        {
          from: 'business',
          text: 'Hello Rohan, I have corrected the name and attached the new invoice.',
        },
        { from: 'customer', text: 'Received, thank you.' },
      ],
      outcomes: [
        'The thread becomes one conversation in the team inbox',
        'It is assigned to billing like any other chat',
        'The reply is a template, filled in for that contact',
      ],
    },
    {
      tag: 'Sales teams',
      title: 'Quote requests to sales@',
      icon: 'doc',
      summary:
        'Everyone on the team can see the thread, the proposal goes out in the same conversation and a call is set before it goes cold.',
      lines: [
        { from: 'customer', text: 'Could you send pricing for 15 seats?' },
        {
          from: 'business',
          text: 'Of course. I have attached our proposal. Would a call on Thursday help?',
        },
        { from: 'customer', text: 'Thursday at 3 works.' },
        { from: 'event', text: 'Task created · Call, Thursday 3:00 PM' },
        { from: 'business', text: 'Booked. Talk to you on Thursday.' },
      ],
      outcomes: [
        'A shared mailbox is open to the whole team',
        'CC, BCC and attachments work as in any mail client',
        'The next step becomes a task on the contact',
      ],
    },
    {
      tag: 'Education',
      title: 'Admission queries by email',
      icon: 'cap',
      summary:
        'Parents and students write to the admissions address, and the answer sits beside their WhatsApp chat.',
      lines: [
        { from: 'customer', text: 'Please share the fee structure and the last date for the MBA.' },
        {
          from: 'business',
          text: 'Attached is the fee sheet. The last date is 30 June. A counsellor will call you.',
        },
        { from: 'event', text: 'Same contact · WhatsApp history shown' },
        { from: 'customer', text: 'Thank you. I will wait for the call.' },
      ],
      outcomes: [
        'An email template carries the standard answer',
        'The reply goes out from the admissions address, in the same thread',
        'The contact’s WhatsApp history sits next to the email',
      ],
    },
    {
      tag: 'Real estate',
      title: 'Brochure and floor-plan requests',
      icon: 'home',
      summary:
        'A buyer asks for details by email, receives them in one reply and is moved on to a site visit.',
      lines: [
        { from: 'customer', text: 'Could you email the brochure and floor plans for Tower B?' },
        {
          from: 'business',
          text: 'Sent, with the floor plans attached. Would you like to see the site?',
        },
        { from: 'customer', text: 'Saturday morning, please.' },
        { from: 'event', text: 'Task created · Site visit, Saturday' },
      ],
      outcomes: [
        'Attachments go out with the reply',
        'The enquiry is saved on the contact with its source',
        'A site visit is added as a task for the agent',
      ],
    },
    {
      tag: 'Support teams',
      title: 'Handing a thread to a colleague',
      icon: 'users',
      summary:
        'When a question belongs to someone else, the thread moves to them with its whole history and a private note.',
      lines: [
        { from: 'customer', text: 'Following up on my earlier question about the API key.' },
        {
          from: 'business',
          text: 'Thanks for waiting. I am passing this to Meera, who handles integrations.',
        },
        { from: 'event', text: 'Assigned to Meera · private note added' },
        {
          from: 'business',
          text: 'Hi, Meera here. I have the details, so you do not need to repeat them.',
        },
      ],
      outcomes: [
        'The full thread moves with the assignment',
        'A private note tells the next person what was tried',
        'The customer never has to explain it twice',
      ],
    },
  ],
  faq: [
    {
      q: 'Does my reply go out from my own address?',
      a: 'Yes. The reply leaves from the mailbox the customer wrote to, in the same thread, with your signature.',
    },
    {
      q: 'Can several people share one mailbox?',
      a: 'Yes. Share an address such as support@ or sales@ with the team, or let people connect their own mailbox where you allow it.',
    },
    {
      q: 'Are email and WhatsApp kept together for the same customer?',
      a: 'Yes. The conversation sits on the same contact, next to their WhatsApp history, so nobody has to look in two places.',
    },
    {
      q: 'What happens if a mailbox stops working?',
      a: 'Mailbox health shows each mailbox’s status. You can reconnect it from there and spot bounces early.',
    },
  ],
};

const SMS: ChannelExtra = {
  hue: '#0284c7',
  sendOnly: true,
  contact: { name: 'Neha Kapoor', look: 'bun', status: 'via MSG91 sender' },
  chat: [
    {
      from: 'business',
      text: 'Reminder: invoice #1043 of ₹4,500 is due this Friday. Pay securely here.',
    },
    { from: 'event', text: 'Delivered · 10:02 AM' },
    { from: 'business', text: 'Your appointment is tomorrow at 11 AM. See you at the clinic.' },
    { from: 'event', text: 'Delivered · 10:03 AM' },
  ],
  floats: [
    { icon: 'cog', t: 'Sender: MSG91', d: 'One of two senders' },
    { icon: 'gauge', t: '1 segment', d: 'Billing shown before sending' },
    { icon: 'check', t: 'Delivered', d: 'Tracked per broadcast' },
  ],
  practice: [
    {
      tag: 'Finance and collections',
      title: 'Payment reminders to the right people',
      icon: 'card',
      summary:
        'A segment of customers with an unpaid invoice gets a short text, and delivery is tracked for the whole send.',
      lines: [
        { from: 'event', text: 'Segment · Unpaid invoices · 312 contacts' },
        {
          from: 'business',
          text: 'Reminder: invoice #1043 of ₹4,500 is due this Friday. Pay securely here.',
        },
        { from: 'event', text: 'Delivered · 10:02 AM' },
      ],
      outcomes: [
        'The audience is a saved segment, not a spreadsheet',
        'Segments and billing are shown before you send',
        'Delivery is tracked for the broadcast',
      ],
    },
    {
      tag: 'Clinics',
      title: 'Reminders for people not on WhatsApp',
      icon: 'calendar',
      summary:
        'Patients who are not reachable on WhatsApp still get the day-before reminder, as a text.',
      lines: [
        {
          from: 'business',
          text: 'Reminder: your visit with Dr. Rao is tomorrow at 11 AM. Please arrive 10 minutes early.',
        },
        { from: 'event', text: 'Delivered · 9:15 AM' },
        { from: 'event', text: 'Same reminder sent on WhatsApp to everyone else' },
      ],
      outcomes: [
        'SMS uses the same broadcasts and campaigns as WhatsApp',
        'Each contact gets the channel that reaches them',
        'Nobody is missed because of the app they use',
      ],
    },
    {
      tag: 'Retail',
      title: 'A short offer to a saved audience',
      icon: 'megaphone',
      summary:
        'A weekend offer goes to customers who bought before, with the segment cost checked before it leaves.',
      lines: [
        { from: 'event', text: 'Message split into 2 segments · cost shown' },
        {
          from: 'business',
          text: 'Weekend offer: 20% off on all shoes, Saturday and Sunday only. Show this text in store.',
        },
        { from: 'event', text: 'Delivered · 11:40 AM' },
      ],
      outcomes: [
        'You see how a message splits into segments before sending',
        'The audience is built from your own contact data',
        'Senders can be switched on or off at any time',
      ],
    },
    {
      tag: 'Events',
      title: 'A last-minute change to every registrant',
      icon: 'bell',
      summary:
        'When the venue changes the day before, one text reaches everyone, including people who never opened the app.',
      lines: [
        {
          from: 'business',
          text: 'Update: tomorrow’s workshop has moved to Hall B, 2nd floor. Same time, 4 PM.',
        },
        { from: 'event', text: 'Delivered · 6:05 PM' },
        { from: 'event', text: '438 of 441 delivered' },
      ],
      outcomes: [
        'One broadcast reaches the whole registration list',
        'Delivery is tracked for the send',
        'A number can be checked before you text it',
      ],
    },
    {
      tag: 'Delivery and logistics',
      title: 'Out for delivery today',
      icon: 'route',
      summary:
        'A plain text tells customers their order is on the way, with no app and no sign-in needed.',
      lines: [
        {
          from: 'business',
          text: 'Your order #4821 is out for delivery today between 2 and 5 PM.',
        },
        { from: 'event', text: 'Delivered · 8:30 AM' },
      ],
      outcomes: [
        'Messages go out from a Twilio number or an MSG91 sender',
        'Several senders can run at once',
        'The same update can also go on WhatsApp',
      ],
    },
    {
      tag: 'Education',
      title: 'Fee deadlines and exam notices',
      icon: 'cap',
      summary: 'A fee deadline reaches every parent on the list, whichever phone they carry.',
      lines: [
        {
          from: 'business',
          text: 'Notice: the second-term fee is due by 15 October. Late fees apply after that date.',
        },
        { from: 'event', text: 'Delivered · 9:00 AM' },
        { from: 'event', text: 'Sent to segment · Class 8 parents' },
      ],
      outcomes: [
        'Segments keep each notice to the people it concerns',
        'Delivery is tracked per broadcast',
        'Replies go through your WhatsApp or website, not SMS',
      ],
    },
  ],
  faq: [
    {
      q: 'How do I know what a message will cost?',
      a: 'The platform shows how your message splits into segments, and what that will bill, before you send.',
    },
    {
      q: 'Can I use SMS together with WhatsApp?',
      a: 'Yes. SMS runs through the same broadcasts and campaigns, so you can message a segment on WhatsApp and text the people WhatsApp cannot reach.',
    },
    {
      q: 'Can I run more than one sender?',
      a: 'Yes. Twilio numbers and MSG91 senders can run side by side, and you can switch any of them on or off without removing it.',
    },
    {
      q: 'Can I check a number before texting it?',
      a: 'Yes. You can check a number before you send, so a bad number does not waste a message.',
    },
  ],
};

const VOICE: ChannelExtra = {
  hue: '#0d9488',
  contact: { name: 'Vikram Singh', look: 'curl', status: 'on WhatsApp' },
  chat: [
    { from: 'customer', text: 'Hi, I was charged twice for my plan this month.' },
    { from: 'business', text: 'I am sorry about that. May I call you to sort it out?' },
    { from: 'customer', text: 'Yes, please call.' },
    { from: 'event', text: 'Call · 4 min · logged on Vikram Singh' },
    { from: 'business', text: 'As promised, here is the summary of what we agreed on the call.' },
  ],
  floats: [
    { icon: 'shield', t: 'Permission requested', d: 'Asked before the call' },
    { icon: 'bell', t: 'Incoming call', d: 'Accept or decline' },
    { icon: 'list', t: 'Call logged', d: 'Saved on the contact' },
  ],
  practice: [
    {
      tag: 'Billing and support',
      title: 'From a tricky chat to a short call',
      icon: 'headset',
      summary:
        'When typing is slower than talking, the agent asks permission, calls from the same chat and sends a summary.',
      lines: [
        { from: 'customer', text: 'I was charged twice for my plan this month.' },
        { from: 'business', text: 'I am sorry about that. May I call you to sort it out?' },
        { from: 'customer', text: 'Yes, please call.' },
        { from: 'event', text: 'Call · 4 min · logged on the contact' },
        { from: 'business', text: 'Here is the summary of what we agreed on the call.' },
      ],
      outcomes: [
        'The Call button sits in the chat you are already in',
        'The call is logged against the contact',
        'The summary goes back into the same conversation',
      ],
    },
    {
      tag: 'Real estate',
      title: 'A payment-plan walkthrough',
      icon: 'home',
      summary:
        'A buyer who has questions about the payment plan gets a call at a time they agreed to, with the chat history on screen.',
      lines: [
        { from: 'customer', text: 'Can you call me about the Tower B payment plan?' },
        {
          from: 'business',
          text: 'Of course. Is now a good time? I will ask for your permission first.',
        },
        { from: 'event', text: 'Calling permission granted' },
        { from: 'event', text: 'Call · 7 min · logged on the contact' },
      ],
      outcomes: [
        'Permission is asked for instead of calling cold',
        'The agent has the whole chat in front of them',
        'A follow-up task can be set straight after',
      ],
    },
    {
      tag: 'Clinics',
      title: 'Follow-up after a visit',
      icon: 'heart',
      summary:
        'A patient who does not understand an instruction gets a quick call from the front desk instead of another long message.',
      lines: [
        { from: 'customer', text: 'I have the instructions but I am not sure about the timings.' },
        { from: 'business', text: 'I can call you now and go through them. Is that all right?' },
        { from: 'customer', text: 'Yes.' },
        { from: 'event', text: 'Call · 3 min · logged on the contact' },
      ],
      outcomes: [
        'Calls are placed from the browser, with no separate phone app',
        'The call is logged where the history already lives',
        'Nothing is recorded unless the patient agrees',
      ],
    },
    {
      tag: 'Sales teams',
      title: 'Walking through a proposal',
      icon: 'doc',
      summary:
        'After a quote goes out in chat, a short call closes the open questions without losing the thread.',
      lines: [
        { from: 'customer', text: 'Can we go over the proposal on a quick call?' },
        { from: 'business', text: 'Sure. Calling you in a minute from this chat.' },
        { from: 'event', text: 'Call · 12 min · logged on the contact' },
        { from: 'business', text: 'Thanks for your time. The revised quote is above.' },
      ],
      outcomes: [
        'Chat, call and quote stay in one conversation',
        'The call is on the contact for the next teammate',
        'The revised quote follows in the same chat',
      ],
    },
    {
      tag: 'Quality and training',
      title: 'Recording only after consent',
      icon: 'lock',
      summary:
        'If you want a call recorded for quality, the person is told first and nothing is saved until they agree.',
      lines: [
        {
          from: 'business',
          text: 'May I record this call for quality? You can say no at any time.',
        },
        { from: 'customer', text: 'Yes, that is fine.' },
        { from: 'event', text: 'Notice shown · Recording started' },
        { from: 'event', text: 'Call · 5 min · recording saved on the contact' },
      ],
      outcomes: [
        'A notice is shown before any recording starts',
        'Recording is something the agent turns on, not a default',
        'The call and its recording live on the contact',
      ],
    },
    {
      tag: 'Front desk',
      title: 'Answering a call from the inbox',
      icon: 'bell',
      summary:
        'When a customer calls, the team sees a popup where they already work and can accept or decline.',
      lines: [
        { from: 'event', text: 'Incoming call · Aarav Mehta · Accept / Decline' },
        {
          from: 'business',
          text: 'Hello Aarav, this is Riya from the front desk. How can I help?',
        },
        { from: 'event', text: 'Call · 2 min · logged on Aarav Mehta' },
      ],
      outcomes: [
        'An incoming call popup shows who is calling',
        'The call is answered in the browser',
        'It is logged against the contact',
      ],
    },
  ],
  faq: [
    {
      q: 'Can I call a customer who has not agreed to calls?',
      a: 'If a contact has not allowed calls, you ask for permission in the chat first instead of calling cold.',
    },
    {
      q: 'Do my team need a phone app?',
      a: 'No. Calls are placed and answered in the browser, from the conversation you are already in.',
    },
    {
      q: 'Are calls recorded automatically?',
      a: 'No. Nothing is recorded until the person agrees, and a notice is shown first. Your agent turns recording on during the call.',
    },
    {
      q: 'Where do I find a past call?',
      a: 'Calls are logged against the contact, so the history sits in one place with their chats.',
    },
  ],
};

export const CHANNEL_EXTRAS: Record<string, ChannelExtra> = {
  whatsapp: WHATSAPP,
  email: EMAIL,
  sms: SMS,
  voice: VOICE,
  ...SOCIAL_EXTRAS,
};
