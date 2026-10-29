import type { ChannelExtra } from './channel-extras';

/** Instagram, Messenger, Telegram and website chat. Same shape as the core channels. */
export const SOCIAL_EXTRAS: Record<string, ChannelExtra> = {
  instagram: {
    hue: '#db2777',
    contact: { name: 'Ananya Rao', look: 'curl', status: 'Instagram Business' },
    chat: [
      { from: 'customer', text: 'Hi! Is the blue kurta from your story still in stock?' },
      { from: 'business', text: 'Yes, in M and L. Sharing the item with you now.' },
      { from: 'customer', text: 'L please. Do you deliver to Pune?' },
      { from: 'business', text: 'We do, in 2 to 3 days. Shall I place the order for you?' },
    ],
    floats: [
      { icon: 'inbox', t: 'In the team inbox', d: 'Beside WhatsApp and email' },
      { icon: 'flow', t: 'Flow answered', d: 'Sizes and delivery' },
      { icon: 'timeline', t: 'One contact', d: 'Same person on WhatsApp' },
    ],
    practice: [
      {
        tag: 'Fashion and retail',
        title: 'Story replies that turn into orders',
        icon: 'bag',
        summary:
          'A follower replies to a story, the DM lands in the team inbox and a flow or a person takes the order forward.',
        lines: [
          { from: 'customer', text: 'Is the blue kurta from your story still in stock?' },
          { from: 'business', text: 'Yes, in M and L. Sharing the item with you now.' },
          { from: 'customer', text: 'L please. Do you deliver to Pune?' },
          { from: 'business', text: 'We do, in 2 to 3 days. Shall I place the order for you?' },
        ],
        outcomes: [
          'The DM reaches the shared inbox and is assigned to sales',
          'The contact joins your CRM with the source recorded',
          'The same person stays one contact across Instagram and WhatsApp',
        ],
      },
      {
        tag: 'Salons and wellness',
        title: 'Booking questions in the DMs',
        icon: 'calendar',
        summary:
          'People ask for a slot where they already follow you, and the front desk answers from the same inbox as everything else.',
        lines: [
          { from: 'customer', text: 'Do you have a slot for a facial this Saturday?' },
          { from: 'business', text: 'Saturday has 11 AM and 3 PM free. Which would you like?' },
          { from: 'customer', text: '3 PM.' },
          { from: 'business', text: 'Booked. We will remind you on Friday.' },
        ],
        outcomes: [
          'A flow handles the common questions',
          'A person takes over for anything it cannot answer',
          'The booking is saved on the contact',
        ],
      },
      {
        tag: 'Real estate',
        title: 'Project enquiries from a follower',
        icon: 'home',
        summary:
          'A follower asks about a project, the agent answers and the conversation turns into a site visit.',
        lines: [
          { from: 'customer', text: 'What is the starting price for the 2 BHK at Greenfield?' },
          {
            from: 'business',
            text: 'Thanks for asking. May I know your budget range so I can suggest the right options?',
          },
          { from: 'customer', text: 'Around 85 lakh.' },
          { from: 'business', text: 'I have two that fit. Would you like to visit this weekend?' },
        ],
        outcomes: [
          'Answers come from your own content',
          'The enquiry becomes a lead with its source',
          'A visit is set up as a task for the agent',
        ],
      },
      {
        tag: 'Coaching and courses',
        title: 'Course questions answered at once',
        icon: 'cap',
        summary:
          'Prospective students ask about batches and timings in DMs, and nobody has to be online to reply.',
        lines: [
          { from: 'customer', text: 'When does the next batch of the design course start?' },
          {
            from: 'business',
            text: 'The next batch starts on the 5th. Weekday and weekend slots are open.',
          },
          { from: 'customer', text: 'Weekend, please.' },
          { from: 'event', text: 'Assigned to Counsellor · Meera' },
        ],
        outcomes: [
          'A flow answers batch and timing questions',
          'Interested people are handed to a counsellor',
          'Every enquiry is on the contact record',
        ],
      },
      {
        tag: 'Offers',
        title: 'A reply-only broadcast',
        icon: 'megaphone',
        summary:
          'One message goes to people who already messaged you, with each conversation’s 24-hour window checked first.',
        lines: [
          { from: 'event', text: 'Reply-only broadcast · windows checked first' },
          {
            from: 'business',
            text: 'The kurta you asked about is back in stock. Want us to hold your size?',
          },
          { from: 'event', text: 'Sent to conversations inside the 24-hour window' },
        ],
        outcomes: [
          'Only existing conversations are offered',
          'The 24-hour window of each is shown before you send',
          'Replies come straight back to the inbox',
        ],
      },
    ],
    faq: [
      {
        q: 'Can a flow answer Instagram messages?',
        a: 'Yes. The same flow builder runs on Instagram conversations, and a person can take over from the inbox whenever it should.',
      },
      {
        q: 'Is someone on Instagram and WhatsApp one contact?',
        a: 'Yes. The same person stays one contact record, so their history is in one place.',
      },
      {
        q: 'What is a reply-only broadcast?',
        a: 'One message to people who already wrote to you, with each conversation’s 24-hour window shown before you send.',
      },
      {
        q: 'Can I disconnect or refresh the account?',
        a: 'Yes. You can refresh the connection or unlink the account at any time.',
      },
    ],
  },

  facebook: {
    hue: '#2563eb',
    contact: { name: 'Meera Joshi', look: 'bun', status: 'Messenger' },
    chat: [
      { from: 'customer', text: 'Hi, are you open on Sunday?' },
      { from: 'business', text: 'Yes, 10 AM to 6 PM. Would you like to book a visit?' },
      { from: 'customer', text: 'Yes, 11 AM works.' },
      { from: 'business', text: 'Booked for Sunday at 11 AM. See you then!' },
    ],
    floats: [
      { icon: 'inbox', t: 'Messenger and comments', d: 'One inbox' },
      { icon: 'calendar', t: 'Post scheduled', d: 'Monday, 9:00 AM' },
      { icon: 'cog', t: 'Greeting set', d: 'Get Started and menu' },
    ],
    practice: [
      {
        tag: 'Local businesses',
        title: 'Opening hours and bookings',
        icon: 'clock',
        summary:
          'The questions every Page gets, answered at once, with a booking taken in the same conversation.',
        lines: [
          { from: 'customer', text: 'Are you open on Sunday?' },
          { from: 'business', text: 'Yes, 10 AM to 6 PM. Would you like to book a visit?' },
          { from: 'customer', text: '11 AM works.' },
          { from: 'business', text: 'Booked for Sunday at 11 AM. See you then!' },
        ],
        outcomes: [
          'Messenger messages arrive in the shared inbox',
          'A flow answers the routine questions',
          'The booking is saved on the contact',
        ],
      },
      {
        tag: 'Retail',
        title: 'A launch announcement, end to end',
        icon: 'megaphone',
        summary:
          'A post is scheduled, the comments and replies come to one place, and people who just chatted get the offer.',
        lines: [
          { from: 'event', text: 'Post scheduled · Monday, 9:00 AM' },
          { from: 'customer', text: 'Is the new range available in Delhi?' },
          { from: 'business', text: 'Yes, in all our Delhi stores from today.' },
          { from: 'event', text: 'Broadcast to people who chatted in the last 24 hours' },
        ],
        outcomes: [
          'Posts are published or scheduled from the same place',
          'Comments and messages reach the inbox',
          'Sent, failed and blocked are tracked per broadcast',
        ],
      },
      {
        tag: 'Events',
        title: 'Ticket and venue questions',
        icon: 'calendar',
        summary:
          'The same five questions arrive before every event, and the answers are ready before the team is.',
        lines: [
          { from: 'customer', text: 'Where is the venue and is there parking?' },
          {
            from: 'business',
            text: 'The venue is Hall B, and there is free parking behind the building.',
          },
          { from: 'customer', text: 'Can I bring a friend?' },
          {
            from: 'business',
            text: 'Yes. Each ticket admits one person, so you can book a second one here.',
          },
        ],
        outcomes: [
          'Ice-breaker questions suggest what to ask first',
          'A persistent menu keeps the options in reach',
          'Anything unusual goes to a person',
        ],
      },
      {
        tag: 'Service businesses',
        title: 'A welcome that sets the tone',
        icon: 'cog',
        summary:
          'The Get Started button, a greeting and a menu give every new visitor a clear first step.',
        lines: [
          { from: 'event', text: 'Get Started tapped' },
          { from: 'business', text: 'Welcome! Tap a topic below, or type your question.' },
          { from: 'event', text: 'Menu · Book a visit · Prices · Talk to us' },
          { from: 'customer', text: 'Talk to us' },
        ],
        outcomes: [
          'The greeting, menu and ice breakers are set up in the platform',
          'People choose a topic instead of staring at a blank box',
          'Talk to us hands the chat to your team',
        ],
      },
      {
        tag: 'Community pages',
        title: 'Comments answered beside the messages',
        icon: 'chat',
        summary:
          'Comments on your Page reach the same inbox, so nothing is missed because it was not a private message.',
        lines: [
          { from: 'customer', text: 'Comment: Do you ship outside the city?' },
          { from: 'business', text: 'Yes, across the country. Delivery takes 3 to 5 days.' },
          { from: 'event', text: 'Comment answered · added to the contact' },
        ],
        outcomes: [
          'Comments arrive in the team inbox',
          'They are answered beside the messages',
          'The history is kept on the contact',
        ],
      },
    ],
    faq: [
      {
        q: 'Can I publish posts from here?',
        a: 'Yes. You can publish, schedule, retry or delete posts on your connected Pages.',
      },
      {
        q: 'Do comments reach the inbox too?',
        a: 'Yes. Comments on your Page arrive in the same team inbox as your Messenger messages.',
      },
      {
        q: 'What is the Messenger welcome setup?',
        a: 'You set the Get Started button, a greeting, a persistent menu and ice-breaker questions, so a new visitor knows what to do first.',
      },
      {
        q: 'Can flows answer Messenger chats?',
        a: 'Yes. Flows can handle the routine questions, and anything else goes to your team in the inbox.',
      },
      {
        q: 'Can I connect more than one Page?',
        a: 'Yes. Connect your Facebook account to bring in your Pages, or connect a single Page.',
      },
    ],
  },

  telegram: {
    hue: '#0284c7',
    contact: { name: 'Arjun Patel', look: 'crop', status: 'via your bot' },
    chat: [
      { from: 'customer', text: '/start' },
      {
        from: 'business',
        text: 'Welcome! I can help with sessions, access and support. What do you need?',
      },
      { from: 'customer', text: 'How do I join Saturday’s session?' },
      { from: 'business', text: 'Here is the link. I will remind you an hour before it starts.' },
    ],
    floats: [
      { icon: 'telegram', t: 'Bot connected', d: 'Token checked' },
      { icon: 'webhook', t: 'Webhook healthy', d: 'Checked just now' },
      { icon: 'flow', t: 'Flow replied', d: 'Routine questions' },
    ],
    practice: [
      {
        tag: 'Communities',
        title: 'A support bot for members',
        icon: 'users',
        summary:
          'Members ask the same questions again and again, so a flow answers them and your team handles the rest.',
        lines: [
          { from: 'customer', text: 'How do I reset my access?' },
          { from: 'business', text: 'Here are the steps. Tell me if any of them does not work.' },
          { from: 'customer', text: 'Step 3 fails for me.' },
          { from: 'event', text: 'Handed to the team inbox · Priya' },
        ],
        outcomes: [
          'A flow answers the common questions',
          'The rest is handed to your team in the inbox',
          'Every member becomes a contact in the CRM',
        ],
      },
      {
        tag: 'Courses and cohorts',
        title: 'Session links and reminders',
        icon: 'cap',
        summary:
          'Students get the link on request and a reminder before the class, without anyone posting it by hand.',
        lines: [
          { from: 'customer', text: 'How do I join Saturday’s session?' },
          { from: 'business', text: 'Here is the link. I will remind you an hour before.' },
          { from: 'event', text: 'Reminder sent · Saturday 3:00 PM' },
          { from: 'business', text: 'Starting in an hour. See you there.' },
        ],
        outcomes: [
          'The same flow builder is used as on WhatsApp',
          'The reminder is sent on time',
          'The chat stays on the member’s record',
        ],
      },
      {
        tag: 'Onboarding',
        title: 'A welcome for every new member',
        icon: 'sparkle',
        summary:
          'A new member starts the bot and is shown where things are, instead of searching a long pinned message.',
        lines: [
          { from: 'customer', text: '/start' },
          { from: 'business', text: 'Welcome! Pick one: Rules, Schedule, or Talk to a person.' },
          { from: 'customer', text: 'Schedule' },
          { from: 'business', text: 'This week: Tuesday Q&A, Thursday workshop, Saturday review.' },
        ],
        outcomes: [
          'The bot answers the first questions at once',
          'A person is one tap away',
          'It can be paused or disconnected any time',
        ],
      },
      {
        tag: 'Paid access',
        title: 'Taking a payment in the chat',
        icon: 'card',
        summary:
          'With a payment token added to the bot, a member can pay for a seat without leaving Telegram.',
        lines: [
          { from: 'customer', text: 'I would like a seat in the Saturday workshop.' },
          { from: 'business', text: 'Seats are open. Pay here to confirm yours.' },
          { from: 'event', text: 'Payment received · seat confirmed' },
          { from: 'business', text: 'You are in. The joining link is above.' },
        ],
        outcomes: [
          'A payment token is added to the bot',
          'The payment happens in the same chat',
          'The member is saved as a contact',
        ],
      },
      {
        tag: 'Support teams',
        title: 'When the flow cannot help',
        icon: 'headset',
        summary:
          'Questions the flow cannot answer are not dropped: they go to a person, with the conversation attached.',
        lines: [
          { from: 'customer', text: 'My invoice was charged to the wrong account.' },
          { from: 'business', text: 'I will pass this to a teammate who can check it.' },
          { from: 'event', text: 'Assigned to Karan · Billing' },
          {
            from: 'business',
            text: 'Hi, this is Karan. I have your details and I am looking into it.',
          },
        ],
        outcomes: [
          'The chat appears in the team inbox',
          'It is assigned like any other conversation',
          'The member never has to repeat themselves',
        ],
      },
    ],
    faq: [
      {
        q: 'Where do I get the token?',
        a: 'From BotFather in Telegram. Create the bot there, copy its token and paste it into the platform.',
      },
      {
        q: 'Can I connect more than one bot?',
        a: 'Yes. You can connect one or more Telegram bots, each with its own token.',
      },
      {
        q: 'How do I know the bot is working?',
        a: 'The platform checks the bot’s webhook, so you can see whether it is healthy.',
      },
      {
        q: 'Can I pause the bot?',
        a: 'Yes. You can pause a bot or disconnect it whenever you need to.',
      },
      {
        q: 'Does a person ever step in?',
        a: 'Yes. Chats a flow cannot answer arrive in your team inbox, where someone can take over.',
      },
    ],
  },

  'web-chat': {
    hue: '#7c3aed',
    contact: { name: 'Sana Khan', look: 'sweep', status: 'on your pricing page' },
    chat: [
      { from: 'customer', text: 'Hi, do you work with schools?' },
      {
        from: 'business',
        text: 'Yes. Schools use us for admissions, notices and parent updates. May I have your email to send details?',
      },
      { from: 'customer', text: 'sana@school.example' },
      { from: 'business', text: 'Thanks, Sana. A teammate will follow up tomorrow morning.' },
    ],
    floats: [
      { icon: 'form', t: 'Pre-chat form', d: 'Name and email' },
      { icon: 'contact', t: 'Contact created', d: 'Source: pricing page' },
      { icon: 'users', t: 'Handed to the team', d: 'Full chat attached' },
    ],
    practice: [
      {
        tag: 'Education',
        title: 'Admission questions at midnight',
        icon: 'cap',
        summary:
          'A parent browses the site after hours, asks about fees and leaves their number for a counsellor.',
        lines: [
          { from: 'customer', text: 'What are the fees for Class 6?' },
          {
            from: 'business',
            text: 'The fee sheet is on our admissions page. May I have your phone number for a counsellor to call?',
          },
          { from: 'customer', text: '98xxxxxx21' },
          { from: 'event', text: 'Contact created · Source: admissions page' },
        ],
        outcomes: [
          'The agent answers from your own content',
          'A contact is created with the page as the source',
          'A counsellor follows up with the full chat',
        ],
      },
      {
        tag: 'Real estate',
        title: 'From a listing page to WhatsApp',
        icon: 'home',
        summary:
          'A visitor looking at a listing prefers WhatsApp, so the bubble offers a jump there and the chat continues.',
        lines: [
          { from: 'customer', text: 'Is this 3 BHK still available?' },
          {
            from: 'business',
            text: 'Yes. Would you like to continue on WhatsApp so I can send photos and the location?',
          },
          { from: 'customer', text: 'Yes please.' },
          { from: 'event', text: 'Continued on WhatsApp · same contact' },
        ],
        outcomes: [
          'The bubble can open an agent chat, WhatsApp or both',
          'The contact stays one record across both',
          'A visit task is set for the agent',
        ],
      },
      {
        tag: 'E-commerce',
        title: 'Delivery and returns questions',
        icon: 'bag',
        summary:
          'The questions shoppers ask just before buying are answered in seconds, while they are still on the page.',
        lines: [
          { from: 'customer', text: 'How long does delivery take, and can I return it?' },
          {
            from: 'business',
            text: 'Delivery takes 3 to 5 days, and you can return within 7 days.',
          },
          { from: 'customer', text: 'Great, thanks.' },
        ],
        outcomes: [
          'The agent answers from your policies',
          'Nothing is lost if the visitor leaves',
          'Hard questions go to the team inbox',
        ],
      },
      {
        tag: 'Software and services',
        title: 'A pricing question after hours',
        icon: 'chart',
        summary:
          'A visitor asks about plans at midnight, shares an email and your team picks it up in the morning.',
        lines: [
          { from: 'customer', text: 'What does the team plan include?' },
          {
            from: 'business',
            text: 'I can walk you through it. What is your email, so I can send the details?',
          },
          { from: 'customer', text: 'amit@company.example' },
          { from: 'event', text: 'Contact created · Handed to the team for the morning' },
        ],
        outcomes: [
          'A pre-chat form can ask for a name and email first',
          'The page is recorded as the source',
          'Your team follows up with the full chat attached',
        ],
      },
      {
        tag: 'Clinics',
        title: 'Booking from the website',
        icon: 'calendar',
        summary:
          'A visitor books a consultation from the site, and the confirmation follows on WhatsApp.',
        lines: [
          { from: 'customer', text: 'I would like to see a dermatologist this week.' },
          {
            from: 'business',
            text: 'Dr. Rao has Thursday 4:30 PM and Friday 11 AM. Which suits you?',
          },
          { from: 'customer', text: 'Thursday.' },
          { from: 'event', text: 'Booked · confirmation sent on WhatsApp' },
        ],
        outcomes: [
          'The agent offers times and confirms the booking',
          'The confirmation can go out on WhatsApp',
          'The patient is saved as a contact',
        ],
      },
    ],
    faq: [
      {
        q: 'Can a visitor continue on WhatsApp?',
        a: 'Yes. You can let visitors chat with an agent, jump to WhatsApp, or choose between the two.',
      },
      {
        q: 'Can I collect an email before the chat starts?',
        a: 'Yes. A pre-chat form can ask for a name and email, so every conversation starts with someone you can identify.',
      },
      {
        q: 'Does the bubble show on every page?',
        a: 'It floats on the pages you choose, with your own look and greeting.',
      },
      {
        q: 'What happens when the agent cannot answer?',
        a: 'The conversation lands in the team inbox with the whole chat attached, so a person can take over.',
      },
      {
        q: 'Can I run more than one website bot?',
        a: 'Yes. Every website bot is listed with the widget it runs in, and you can copy its install code from there.',
      },
    ],
  },
};
