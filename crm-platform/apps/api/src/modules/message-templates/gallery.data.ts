import type { TemplateGalleryCategory, TemplateGalleryItem } from '@crm/contracts';

/**
 * The template gallery's content: ready-made WhatsApp templates by use. Names, texts and sample values only; phone numbers and links
 * are placeholders the author replaces. A header picture is not shipped: the author adds their own when they use the template.
 */
export const GALLERY_CATEGORY_NAMES: Readonly<Record<TemplateGalleryCategory, string>> = {
  ecommerce: 'Ecommerce',
  food_delivery: 'Food Delivery',
  festival_season: 'Festival Season',
  education: 'Education',
  travel: 'Travel',
  others: 'Others',
};

const header = (text: string) => ({ type: 'HEADER' as const, format: 'TEXT', text });
const image = () => ({ type: 'HEADER' as const, format: 'IMAGE' });
const body = (text: string, samples: string[]) => ({
  type: 'BODY' as const,
  text,
  example: { body_text: [samples] },
});
const footer = (text: string) => ({ type: 'FOOTER' as const, text });
const buttons = (...b: Array<Record<string, unknown> & { type: string }>) => ({
  type: 'BUTTONS' as const,
  buttons: b,
});
const call = (text: string) => ({ type: 'PHONE_NUMBER', text, phone_number: '+15550100100' });
const link = (text: string, url = 'https://example.com/') => ({ type: 'URL', text, url });
const reply = (text: string) => ({ type: 'QUICK_REPLY', text });

const tpl = (
  id: string,
  name: string,
  category: TemplateGalleryCategory,
  template_category: 'MARKETING' | 'UTILITY',
  components: TemplateGalleryItem['components'],
): TemplateGalleryItem => ({
  id,
  name,
  category,
  template_category,
  button_type: components.some((c) => c.type === 'BUTTONS')
    ? 'copy_code_url_quick_replies_etc'
    : 'none',
  components,
});

export const GALLERY_TEMPLATES: readonly TemplateGalleryItem[] = [
  tpl('admission_inquiry', 'Admission Inquiry', 'education', 'MARKETING', [
    header('Thank you for your interest'),
    body(
      "Hi {{1}}, thank you for your interest in our {{2}}. The deadline for admissions is {{3}}, and spots are filling up quickly! Don't miss out: secure your place before it's too late!\nLast date to apply: {{4}}. We look forward to hearing from you.",
      ['Name', 'Institution', 'Deadline', 'Date'],
    ),
    buttons(call('Call us Today')),
  ]),
  tpl('upcoming_exam_reminder', 'Upcoming Exam Reminder', 'education', 'UTILITY', [
    header('Mid-term Reminder'),
    body(
      'Hello {{1}}, your mid-term exams are set to start on {{2}}. You can find the full exam schedule by following the link below. Wishing you all the best for your exams!',
      ['Name', 'Date'],
    ),
    buttons(link('Check Timetable')),
  ]),
  tpl('food_order_delivered', 'food order delivered', 'food_delivery', 'MARKETING', [
    body(
      "Hey {{1}}, your order from {{2}} has been successfully delivered to your doorstep. 🍔🍟🚚 We hope you're as excited as we are! 😀 Thank you for choosing {{3}}. Enjoy your feast! 🍱🥗",
      ['name', 'id', 'options'],
    ),
    buttons(call('Speak to customer care')),
  ]),
  tpl('survey', 'Survey', 'others', 'MARKETING', [
    body(
      "Hello {{1}},\nWe hope you're happy with your recent purchase.\nYour feedback is important to us. Please let us know how we did and how we can improve.",
      ['Name'],
    ),
    buttons(link('Love It')),
  ]),
  tpl('travel_offer', 'Travel Offer', 'travel', 'MARKETING', [
    image(),
    body(
      'Hi {{1}}, the Ultimate Travel Sale is here! 🏖️🏔️🌆 Enjoy up to 25% off on flight bookings ✈️✈️ Use code: WANDERLUST at checkout. Hurry, this offer ends on February 28th!',
      ['Name'],
    ),
  ]),
  tpl('flight_delay', 'Flight Delay', 'travel', 'UTILITY', [
    header('Your flight is delayed.'),
    body(
      "Hi {{1}}, your flight {{2}} is delayed. The new estimated departure time is {{3}}. We'll keep you updated with any new information. We apologize for any inconvenience this may cause.",
      ['Name', 'flight number', 'time'],
    ),
    buttons(call('Contact support agent'), link('Check Details')),
  ]),
  tpl('browse_catalog_on_whatsapp', 'browse catalog on whatsapp', 'ecommerce', 'MARKETING', [
    header('Browse our catalog right here!'),
    body(
      "Hey {{1}} 👋 Exciting news! You can now browse our catalog right here on WhatsApp! 🎉 Click below, and we'll guide you through our collections! 🛍️",
      ['name'],
    ),
    buttons(reply('View Product'), reply('Stop')),
  ]),
  tpl('order_out_for_delivery', 'order out for delivery', 'ecommerce', 'UTILITY', [
    header('Order Out for Delivery!'),
    body(
      'Hello {{1}},\nExciting update! Your order #{{2}} is on its way and will be arriving at your address shortly.\nYou can monitor the delivery status via the link provided below. We appreciate your business and look forward to serving you again!',
      ['name', 'id'],
    ),
    buttons({ ...link('Track Order', 'https://example.com/{{1}}'), example: ['order-123'] }),
  ]),
  tpl('festive_loan_offer', 'festive loan offer', 'festival_season', 'MARKETING', [
    header('Illuminate Diwali with Our Festive Loan Offer'),
    body(
      'Hi {{1}},\nCelebrate Diwali with extra joy through our exclusive Diwali Loan Offer! 🪔🪔\nLoan limit up to 10 lakhs\nAttractive Interest Rates\nFlexible Repayment Plans',
      ['name'],
    ),
    buttons(link('Upload Picture'), call('Customer Care')),
  ]),
  tpl('we_miss_you', 'We Miss You', 'others', 'MARKETING', [
    body(
      "Hello {{1}},\nWe've been missing you! Return to our store and receive a 20% discount on your purchase until December 15th.\nTake advantage of this exclusive offer just for you!",
      ['name'],
    ),
    footer('Type STOP to unsubscribe'),
    buttons({ ...link('Shop Now', 'https://example.com/cta?redirect={{1}}'), example: ['text'] }),
  ]),
  tpl('flash_sale', 'Flash Sale', 'others', 'MARKETING', [
    body(
      "Hello {{1}},\nToday is your chance to get 35% off on all your favorite products!\nWith a bunch of new arrivals over the past two months, you'll have plenty of choices.\nHurry and shop your favorites before the offer ends!",
      ['Name'],
    ),
    buttons(link('Shop Now!')),
  ]),
  tpl('we_are_closed', 'We Are Closed', 'others', 'MARKETING', [
    image(),
    body(
      "Hello {{1}},\nWe're on a break for the Diwali holidays and will return on {{2}}.\nIn the meantime, you can shop online or visit our FAQ page for any questions.\nFor urgent concerns, please email us, and we'll get back to you as soon as possible.\nWishing you a joyful Diwali with your loved ones!",
      ['Name', 'Date'],
    ),
    buttons(link('Shop Online')),
  ]),
  tpl('tuition_fees_reminder', 'Tuition Fees Reminder', 'education', 'UTILITY', [
    header('Tuition Reminder'),
    body(
      'Hello {{1}}, a reminder that your mid-term fees of {{2}} are due by {{3}}. To avoid any late fees, please ensure payment is made by the due date.',
      ['Name', 'Amount', 'due date'],
    ),
    buttons(link('Pay Now')),
  ]),
  tpl(
    'abandoned_cart_food_ordering',
    'abandoned cart food ordering',
    'food_delivery',
    'MARKETING',
    [
      header('Why resist the temptation of our yummy food anymore?'),
      body(
        "Hi {{1}},\nIt looks like you're craving our Italian menu! 😋🍝 Don't wait: order now and indulge in our classic pasta and wood-fired pizza. We've got all your favorites ready to go! 🍕🍕",
        ['name'],
      ),
      buttons(link('Place Your Order', 'https://example.com/shop')),
    ],
  ),
  tpl('order_cancelled', 'order cancelled', 'ecommerce', 'UTILITY', [
    header('Your order is Cancelled'),
    body(
      'Hi {{1}},\nYour order with ID #{{2}} has been canceled.\nThe refund process has started, and you should see the amount in your account within 2-3 business days.',
      ['name', 'id'],
    ),
    buttons(reply('Confirm Order'), reply('Cancel Order')),
  ]),
  tpl('vip_list', 'VIP List', 'others', 'MARKETING', [
    body(
      'Hello {{1}},\nWe appreciate your loyalty!\nGet exclusive updates on new launches, discounts, and offers at {{2}} by joining our VIP list. Click below to sign up.',
      ['Name', 'Company name'],
    ),
    buttons(link('Join Now')),
  ]),
  tpl('room_reservation_confirmation', 'Room Reservation Confirmation', 'travel', 'UTILITY', [
    header('Reservation Confirmed!'),
    body(
      "Hi {{1}}, thank you for booking with us at {{2}} on {{3}}. We're excited to welcome you and look forward to your stay!",
      ['Name', 'Date', 'Time'],
    ),
    buttons(call('Contact customer care')),
  ]),
];
