import type {
  BookingReminderKind,
  BookingReminderStepKind,
  ReminderPackKey,
  ReminderPackLanguage,
} from '@crm/contracts';

/**
 * The reminder packs (BL-424): seven predefined sequences, each with its messages in English and Hindi. Versioned data: a change to
 * any text, time or switch bumps `PACKS_VERSION` and a test (reminder-packs.spec.ts) checks every message for valid placeholders and for
 * the limits Meta puts on a template.
 *
 * Writing rules, because a template that Meta refuses blocks the step:
 *  - WhatsApp variables go in the FIXED order name, type (the service), date, time, location (the place), join_link, manage_link, and a
 *    body uses a leading run of that list, first written in that order (this is what the message library enforces and what the sender
 *    fills). A body never starts or ends with a variable and never puts two next to each other.
 *  - Email may also use `host_name`, `host_phone` and `map_link` (WhatsApp cannot: its order is fixed).
 *  - Short and polite. A pack that serves a medical practice says "your appointment" and nothing about the visit: its steps carry
 *    `serviceLabel`, which replaces the service name in the variables, so a booking type called "Cardiology review" is never named.
 *  - The Hindi text is a machine draft. The screen says so and the owner reads it before switching a step on.
 */
export const PACKS_VERSION = 1;

export interface PackText {
  /** The email subject. */
  subject: string;
  /** The email body. */
  email: string;
  /** The WhatsApp body, written with names; stored with numbered placeholders. */
  wa: string;
}

export interface PackStepData {
  stepKind: BookingReminderStepKind;
  kind: BookingReminderKind;
  offsetMinutes: number;
  isActive: boolean;
  buttons: boolean;
  skipIfConfirmed: boolean;
  onlineOnly: boolean;
  category: 'UTILITY' | 'MARKETING';
  text: Record<ReminderPackLanguage, PackText>;
}

export interface PackData {
  key: ReminderPackKey;
  name: string;
  description: string;
  /** What replaces the service name in the variables (a medical practice shows "appointment", not the service). */
  serviceLabel: Record<ReminderPackLanguage, string> | null;
  steps: PackStepData[];
}

export const PACK_BUTTONS: Record<ReminderPackLanguage, [string, string, string]> = {
  en: ['Confirm', 'Reschedule', 'Cancel'],
  hi: ['पुष्टि करें', 'समय बदलें', 'रद्द करें'],
};

const MIN = { day: 1440 };

// --- the steps every pack shares in shape -------------------------------------------------------------------------------------

type Draft = Omit<PackStepData, 'kind' | 'skipIfConfirmed' | 'onlineOnly' | 'category' | 'buttons' | 'isActive'> &
  Partial<Pick<PackStepData, 'skipIfConfirmed' | 'onlineOnly' | 'category' | 'buttons' | 'isActive'>>;

const step = (d: Draft): PackStepData => ({
  kind:
    d.stepKind === 'confirmation' || d.stepKind === 'no_show'
      ? 'event'
      : d.stepKind === 'after_visit' || d.stepKind === 'rebook'
        ? 'after'
        : 'before',
  isActive: true,
  buttons: false,
  skipIfConfirmed: false,
  onlineOnly: false,
  category: d.stepKind === 'after_visit' || d.stepKind === 'rebook' ? 'MARKETING' : 'UTILITY',
  ...d,
});

const confirmation = (text: PackStepData['text']): PackStepData =>
  step({ stepKind: 'confirmation', offsetMinutes: 0, text });
const day = (text: PackStepData['text']): PackStepData =>
  step({ stepKind: 'reminder_24h', offsetMinutes: MIN.day, buttons: true, text });
const twoHours = (text: PackStepData['text']): PackStepData =>
  step({ stepKind: 'reminder_2h', offsetMinutes: 120, skipIfConfirmed: false, text });
const noShow = (text: PackStepData['text'], isActive = true): PackStepData =>
  step({ stepKind: 'no_show', offsetMinutes: 1, isActive, text });
const afterVisit = (text: PackStepData['text'], isActive = true): PackStepData =>
  step({ stepKind: 'after_visit', offsetMinutes: 120, isActive, text });
const rebook = (days: number, text: PackStepData['text'], isActive = false): PackStepData =>
  step({ stepKind: 'rebook', offsetMinutes: days * MIN.day, isActive, text });

// --- clinic and dental: no medical detail, only "your appointment" --------------------------------------------------------------

const MEDICAL = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is confirmed',
      email:
        'Hi {{name}},\n\nYour {{type}} is confirmed for {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nThank you.',
      wa: 'Hi {{name}}, your {{type}} is confirmed for {{date}} at {{time}}. Please reply here if you need any help. Thank you.',
    },
    hi: {
      subject: 'आपका {{type}} पक्का हो गया है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} {{date}} को {{time}} बजे के लिए पक्का हो गया है।\n\nस्थान: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nधन्यवाद।',
      wa: 'नमस्ते {{name}}, आपका {{type}} दिनांक {{date}} को {{time}} बजे के लिए पक्का हो गया है। कोई सहायता चाहिए तो यहाँ उत्तर दें। धन्यवाद।',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nThis is a reminder about your {{type}} on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nSee you soon.',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपका {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nयह आपके {{type}} की याद दिलाना है: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nजल्द मिलते हैं।',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपका {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  twoHours: {
    en: {
      subject: 'Your {{type}} is in about 2 hours',
      email:
        'Hi {{name}},\n\nYour {{type}} is in about 2 hours, on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nSee you soon.',
      wa: 'Hi {{name}}, your {{type}} is in about 2 hours, on {{date}} at {{time}}. We look forward to seeing you.',
    },
    hi: {
      subject: 'आपका {{type}} लगभग 2 घंटे में है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} लगभग 2 घंटे में है: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\n\nजल्द मिलते हैं।',
      wa: 'नमस्ते {{name}}, आपका {{type}} लगभग 2 घंटे में है, {{date}} को {{time}} बजे। हम आपका इंतज़ार करेंगे।',
    },
  },
  noShow: {
    en: {
      subject: 'We missed you',
      email:
        'Hi {{name}},\n\nWe missed you at your {{type}} on {{date}} at {{time}}.\n\nReply to this email and we will help you find a new time.',
      wa: 'Hi {{name}}, we missed you at your {{type}} on {{date}} at {{time}}. Reply here and we will help you find a new time.',
    },
    hi: {
      subject: 'हमने आपको याद किया',
      email:
        'नमस्ते {{name}},\n\n{{date}} को {{time}} बजे आपके {{type}} में हम आपसे नहीं मिल पाए।\n\nइस ईमेल का उत्तर दें, हम नया समय तय करने में मदद करेंगे।',
      wa: 'नमस्ते {{name}}, आपके {{type}} में दिनांक {{date}} को {{time}} बजे हम आपसे नहीं मिल पाए। यहाँ उत्तर दें, हम नया समय तय करने में मदद करेंगे।',
    },
  },
  afterVisit: {
    en: {
      subject: 'Thank you for visiting us',
      email:
        'Hi {{name}},\n\nThank you for visiting us for your {{type}} on {{date}}. We hope everything went well.\n\nIf you have any questions, just reply to this email.',
      wa: 'Hi {{name}}, thank you for visiting us for your {{type}} on {{date}}. We hope everything went well. Reply here if you have any questions.',
    },
    hi: {
      subject: 'हमसे मिलने के लिए धन्यवाद',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपके {{type}} के लिए आने का धन्यवाद। हमें आशा है सब ठीक रहा।\n\nकोई प्रश्न हो तो इस ईमेल का उत्तर दें।',
      wa: 'नमस्ते {{name}}, आपके {{type}} के लिए दिनांक {{date}} को आने का धन्यवाद। हमें आशा है सब ठीक रहा। कोई प्रश्न हो तो यहाँ उत्तर दें।',
    },
  },
  rebook: {
    en: {
      subject: 'Time for your next visit?',
      email:
        'Hi {{name}},\n\nIt has been a while since your last {{type}}.\n\nReply to this email whenever you would like to book your next visit.',
      wa: 'Hi {{name}}, it has been a while since your last {{type}}. Reply here whenever you would like to book your next visit.',
    },
    hi: {
      subject: 'अगली बार कब मिलना चाहेंगे?',
      email:
        'नमस्ते {{name}},\n\nआपके पिछले {{type}} को काफ़ी समय हो गया है।\n\nअगली बार बुक करना चाहें तो इस ईमेल का उत्तर दें।',
      wa: 'नमस्ते {{name}}, आपके पिछले {{type}} को काफ़ी समय हो गया है। अगली बार बुक करना चाहें तो यहाँ उत्तर दें।',
    },
  },
} as const;

const MEDICAL_LABEL = { en: 'appointment', hi: 'अपॉइंटमेंट' } as const;

const medicalSteps = (rebookDays: number): PackStepData[] => [
  confirmation(MEDICAL.confirmation),
  day(MEDICAL.day),
  twoHours(MEDICAL.twoHours),
  noShow(MEDICAL.noShow),
  afterVisit(MEDICAL.afterVisit, false),
  rebook(rebookDays, MEDICAL.rebook, false),
];

// --- salon and spa ---------------------------------------------------------------------------------------------------------------

const SALON: Record<string, PackStepData['text']> = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is booked',
      email:
        'Hi {{name}},\n\nYour {{type}} is booked for {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nWe look forward to seeing you!',
      wa: 'Hi {{name}}, your {{type}} is booked for {{date}} at {{time}}. We look forward to seeing you!',
    },
    hi: {
      subject: 'आपकी {{type}} बुक हो गई है',
      email:
        'नमस्ते {{name}},\n\nआपकी {{type}} {{date}} को {{time}} बजे के लिए बुक हो गई है।\n\nस्थान: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nहम आपका इंतज़ार करेंगे!',
      wa: 'नमस्ते {{name}}, आपकी {{type}} दिनांक {{date}} को {{time}} बजे के लिए बुक हो गई है। हम आपका इंतज़ार करेंगे!',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nA reminder about your {{type}} on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपकी {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nआपकी {{type}} की याद दिलाना: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपकी {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  twoHours: {
    en: {
      subject: 'See you soon for your {{type}}',
      email: 'Hi {{name}},\n\nSee you soon! Your {{type}} is on {{date}} at {{time}}.\n\nWhere: {{location}}',
      wa: 'Hi {{name}}, see you soon! Your {{type}} is on {{date}} at {{time}}. We cannot wait to welcome you.',
    },
    hi: {
      subject: 'आपकी {{type}} के लिए जल्द मिलते हैं',
      email: 'नमस्ते {{name}},\n\nजल्द मिलते हैं! आपकी {{type}} {{date}} को {{time}} बजे है।\n\nस्थान: {{location}}',
      wa: 'नमस्ते {{name}}, जल्द मिलते हैं! आपकी {{type}} दिनांक {{date}} को {{time}} बजे है। हम आपके स्वागत के लिए तैयार हैं।',
    },
  },
  afterVisit: {
    en: {
      subject: 'Thank you for visiting us',
      email:
        'Hi {{name}},\n\nThank you for your {{type}} on {{date}}. We hope you loved it.\n\nWe would value your feedback: reply to this email and tell us how we did.',
      wa: 'Hi {{name}}, thank you for your {{type}} on {{date}}. We hope you loved it. We would value your feedback: reply here and tell us how we did.',
    },
    hi: {
      subject: 'हमसे मिलने के लिए धन्यवाद',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपकी {{type}} के लिए धन्यवाद। हमें आशा है आपको पसंद आई।\n\nआपकी राय हमारे लिए महत्वपूर्ण है: इस ईमेल का उत्तर देकर बताइए कि हमारी सेवा कैसी रही।',
      wa: 'नमस्ते {{name}}, आपकी {{type}} के लिए दिनांक {{date}} को धन्यवाद। हमें आशा है आपको पसंद आई। आपकी राय हमारे लिए महत्वपूर्ण है: यहाँ उत्तर देकर बताइए कि हमारी सेवा कैसी रही।',
    },
  },
  rebook: {
    en: {
      subject: 'Ready for your next visit?',
      email:
        'Hi {{name}},\n\nIt has been a few weeks since your {{type}}.\n\nReply to this email to book your next visit.',
      wa: 'Hi {{name}}, it has been a few weeks since your {{type}}. Reply here to book your next visit.',
    },
    hi: {
      subject: 'अगली बार के लिए तैयार हैं?',
      email:
        'नमस्ते {{name}},\n\nआपकी {{type}} को कुछ सप्ताह हो गए हैं।\n\nअगली बार बुक करने के लिए इस ईमेल का उत्तर दें।',
      wa: 'नमस्ते {{name}}, आपकी {{type}} को कुछ सप्ताह हो गए हैं। अगली बार बुक करने के लिए यहाँ उत्तर दें।',
    },
  },
};

// --- property visit ---------------------------------------------------------------------------------------------------------------

const PROPERTY: Record<string, PackStepData['text']> = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is confirmed',
      email:
        'Hi {{name}},\n\nYour {{type}} is confirmed for {{date}} at {{time}}.\n\nAddress: {{location}}\nMap: {{map_link}}\nYour agent: {{host_name}} {{host_phone}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nWe look forward to meeting you.',
      wa: 'Hi {{name}}, your {{type}} is confirmed for {{date}} at {{time}}, at {{location}}. Reply here to reach your agent. Thank you.',
    },
    hi: {
      subject: 'आपका {{type}} पक्का हो गया है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} {{date}} को {{time}} बजे के लिए पक्का हो गया है।\n\nपता: {{location}}\nनक्शा: {{map_link}}\nआपके एजेंट: {{host_name}} {{host_phone}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nहम आपसे मिलने के लिए उत्सुक हैं।',
      wa: 'नमस्ते {{name}}, आपका {{type}} दिनांक {{date}} को {{time}} बजे के लिए पक्का हो गया है, स्थान: {{location}}। अपने एजेंट से बात करने के लिए यहाँ उत्तर दें। धन्यवाद।',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nA reminder about your {{type}} on {{date}} at {{time}}.\n\nAddress: {{location}}\nMap: {{map_link}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपका {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nआपके {{type}} की याद दिलाना: {{date}} को {{time}} बजे।\n\nपता: {{location}}\nनक्शा: {{map_link}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपका {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  twoHours: {
    en: {
      subject: 'Your {{type}} is in about 2 hours',
      email:
        'Hi {{name}},\n\nYour {{type}} is in about 2 hours, on {{date}} at {{time}}.\n\nAddress: {{location}}\nMap: {{map_link}}\nYour agent: {{host_name}} {{host_phone}}',
      wa: 'Hi {{name}}, your {{type}} is in about 2 hours, on {{date}} at {{time}}, at {{location}}. Reply here if you need directions or want to reach your agent.',
    },
    hi: {
      subject: 'आपका {{type}} लगभग 2 घंटे में है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} लगभग 2 घंटे में है: {{date}} को {{time}} बजे।\n\nपता: {{location}}\nनक्शा: {{map_link}}\nआपके एजेंट: {{host_name}} {{host_phone}}',
      wa: 'नमस्ते {{name}}, आपका {{type}} लगभग 2 घंटे में है, {{date}} को {{time}} बजे, स्थान: {{location}}। रास्ता पूछना हो या एजेंट से बात करनी हो तो यहाँ उत्तर दें।',
    },
  },
  noShow: {
    en: {
      subject: 'We missed you',
      email:
        'Hi {{name}},\n\nWe missed you at your {{type}} on {{date}} at {{time}}.\n\nReply to this email and we will arrange another visit.',
      wa: 'Hi {{name}}, we missed you at your {{type}} on {{date}} at {{time}}. Reply here and we will arrange another visit.',
    },
    hi: {
      subject: 'हमने आपको याद किया',
      email:
        'नमस्ते {{name}},\n\n{{date}} को {{time}} बजे आपके {{type}} में हम आपसे नहीं मिल पाए।\n\nइस ईमेल का उत्तर दें, हम दूसरी विज़िट तय कर देंगे।',
      wa: 'नमस्ते {{name}}, आपके {{type}} में दिनांक {{date}} को {{time}} बजे हम आपसे नहीं मिल पाए। यहाँ उत्तर दें, हम दूसरी विज़िट तय कर देंगे।',
    },
  },
  afterVisit: {
    en: {
      subject: 'How was your visit?',
      email:
        'Hi {{name}},\n\nThank you for your {{type}} on {{date}}.\n\nWe would value your feedback: reply to this email and tell us what you liked and what we can do better.',
      wa: 'Hi {{name}}, thank you for your {{type}} on {{date}}. We would value your feedback: reply here and tell us what you liked and what we can do better.',
    },
    hi: {
      subject: 'आपकी विज़िट कैसी रही?',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपके {{type}} के लिए धन्यवाद।\n\nआपकी राय हमारे लिए महत्वपूर्ण है: इस ईमेल का उत्तर देकर बताइए कि आपको क्या पसंद आया और हम क्या बेहतर कर सकते हैं।',
      wa: 'नमस्ते {{name}}, आपके {{type}} के लिए दिनांक {{date}} को धन्यवाद। आपकी राय हमारे लिए महत्वपूर्ण है: यहाँ उत्तर देकर बताइए कि आपको क्या पसंद आया और हम क्या बेहतर कर सकते हैं।',
    },
  },
};

// --- sales meeting, demo, consultation ----------------------------------------------------------------------------------------------

const SALES: Record<string, PackStepData['text']> = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is confirmed',
      email:
        'Hi {{name}},\n\nYour {{type}} is confirmed for {{date}} at {{time}}.\n\nWhere: {{location}}\nJoin link: {{join_link}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nLooking forward to speaking with you.',
      wa: 'Hi {{name}}, your {{type}} is confirmed for {{date}} at {{time}}. Where: {{location}}. Join link: {{join_link}}. Looking forward to speaking with you.',
    },
    hi: {
      subject: 'आपका {{type}} पक्का हो गया है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} {{date}} को {{time}} बजे के लिए पक्का हो गया है।\n\nस्थान: {{location}}\nजुड़ने का लिंक: {{join_link}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nआपसे बात करने के लिए उत्सुक हैं।',
      wa: 'नमस्ते {{name}}, आपका {{type}} दिनांक {{date}} को {{time}} बजे के लिए पक्का हो गया है। स्थान: {{location}}। जुड़ने का लिंक: {{join_link}}। आपसे बात करने के लिए उत्सुक हैं।',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nA reminder about your {{type}} on {{date}} at {{time}}.\n\nWhere: {{location}}\nJoin link: {{join_link}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपका {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nआपके {{type}} की याद दिलाना: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\nजुड़ने का लिंक: {{join_link}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपका {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  fifteen: {
    en: {
      subject: 'Your {{type}} starts in 15 minutes',
      email:
        'Hi {{name}},\n\nYour {{type}} starts in 15 minutes, on {{date}} at {{time}}.\n\nJoin link: {{join_link}}\n\nSee you there.',
      wa: 'Hi {{name}}, your {{type}} starts in 15 minutes, on {{date}} at {{time}}. Where: {{location}}. Join here: {{join_link}}. See you there.',
    },
    hi: {
      subject: 'आपका {{type}} 15 मिनट में शुरू होगा',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} 15 मिनट में शुरू होगा: {{date}} को {{time}} बजे।\n\nजुड़ने का लिंक: {{join_link}}\n\nवहाँ मिलते हैं।',
      wa: 'नमस्ते {{name}}, आपका {{type}} 15 मिनट में शुरू होगा, {{date}} को {{time}} बजे। स्थान: {{location}}। यहाँ से जुड़ें: {{join_link}}। वहाँ मिलते हैं।',
    },
  },
  noShow: {
    en: {
      subject: 'We missed you',
      email:
        'Hi {{name}},\n\nWe missed you at your {{type}} on {{date}} at {{time}}.\n\nReply to this email and we will gladly set up another time.',
      wa: 'Hi {{name}}, we missed you at your {{type}} on {{date}} at {{time}}. Reply here and we will gladly set up another time.',
    },
    hi: {
      subject: 'हमने आपको याद किया',
      email:
        'नमस्ते {{name}},\n\n{{date}} को {{time}} बजे आपके {{type}} में हम आपसे नहीं मिल पाए।\n\nइस ईमेल का उत्तर दें, हम खुशी से नया समय तय कर देंगे।',
      wa: 'नमस्ते {{name}}, आपके {{type}} में दिनांक {{date}} को {{time}} बजे हम आपसे नहीं मिल पाए। यहाँ उत्तर दें, हम खुशी से नया समय तय कर देंगे।',
    },
  },
  afterVisit: {
    en: {
      subject: 'Thank you, and the next steps',
      email:
        'Hi {{name}},\n\nThank you for your {{type}} on {{date}}.\n\nReply to this email with any questions and we will share the next steps.',
      wa: 'Hi {{name}}, thank you for your {{type}} on {{date}}. Reply here with any questions and we will share the next steps.',
    },
    hi: {
      subject: 'धन्यवाद, और आगे के कदम',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपके {{type}} के लिए धन्यवाद।\n\nकोई प्रश्न हो तो इस ईमेल का उत्तर दें, हम आगे के कदम साझा करेंगे।',
      wa: 'नमस्ते {{name}}, आपके {{type}} के लिए दिनांक {{date}} को धन्यवाद। कोई प्रश्न हो तो यहाँ उत्तर दें, हम आगे के कदम साझा करेंगे।',
    },
  },
};

// --- fitness and wellness studio ---------------------------------------------------------------------------------------------------

const FITNESS: Record<string, PackStepData['text']> = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is booked',
      email:
        'Hi {{name}},\n\nYour {{type}} is booked for {{date}} at {{time}}.\n\nWhere: {{location}}\n\nPlease arrive 10 minutes early.\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, your {{type}} is booked for {{date}} at {{time}}. Please arrive 10 minutes early. See you soon!',
    },
    hi: {
      subject: 'आपका {{type}} बुक हो गया है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} {{date}} को {{time}} बजे के लिए बुक हो गया है।\n\nस्थान: {{location}}\n\nकृपया 10 मिनट पहले पहुँचें।\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, आपका {{type}} दिनांक {{date}} को {{time}} बजे के लिए बुक हो गया है। कृपया 10 मिनट पहले पहुँचें। जल्द मिलते हैं!',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nA reminder about your {{type}} on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपका {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nआपके {{type}} की याद दिलाना: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपका {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  twoHours: {
    en: {
      subject: 'Your {{type}} is in about 2 hours',
      email: 'Hi {{name}},\n\nYour {{type}} is in about 2 hours, on {{date}} at {{time}}.\n\nWhere: {{location}}\n\nSee you there!',
      wa: 'Hi {{name}}, your {{type}} is in about 2 hours, on {{date}} at {{time}}. See you at the studio!',
    },
    hi: {
      subject: 'आपका {{type}} लगभग 2 घंटे में है',
      email: 'नमस्ते {{name}},\n\nआपका {{type}} लगभग 2 घंटे में है: {{date}} को {{time}} बजे।\n\nस्थान: {{location}}\n\nवहाँ मिलते हैं!',
      wa: 'नमस्ते {{name}}, आपका {{type}} लगभग 2 घंटे में है, {{date}} को {{time}} बजे। स्टूडियो में मिलते हैं!',
    },
  },
  noShow: {
    en: {
      subject: 'We missed you',
      email:
        'Hi {{name}},\n\nWe missed you at your {{type}} on {{date}} at {{time}}.\n\nReply to this email and we will help you pick another session.',
      wa: 'Hi {{name}}, we missed you at your {{type}} on {{date}} at {{time}}. Reply here and we will help you pick another session.',
    },
    hi: {
      subject: 'हमने आपको याद किया',
      email:
        'नमस्ते {{name}},\n\n{{date}} को {{time}} बजे आपके {{type}} में हम आपसे नहीं मिल पाए।\n\nइस ईमेल का उत्तर दें, हम दूसरा सत्र चुनने में मदद करेंगे।',
      wa: 'नमस्ते {{name}}, आपके {{type}} में दिनांक {{date}} को {{time}} बजे हम आपसे नहीं मिल पाए। यहाँ उत्तर दें, हम दूसरा सत्र चुनने में मदद करेंगे।',
    },
  },
  afterVisit: {
    en: {
      subject: 'How was your session?',
      email:
        'Hi {{name}},\n\nThank you for joining your {{type}} on {{date}}. We hope you enjoyed it.\n\nReply to this email to learn about our plans or to book your next session.',
      wa: 'Hi {{name}}, thank you for joining your {{type}} on {{date}}. We hope you enjoyed it. Reply here to learn about our plans or to book your next session.',
    },
    hi: {
      subject: 'आपका सत्र कैसा रहा?',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपके {{type}} में शामिल होने का धन्यवाद। हमें आशा है आपको अच्छा लगा।\n\nहमारी योजनाओं के बारे में जानने या अगला सत्र बुक करने के लिए इस ईमेल का उत्तर दें।',
      wa: 'नमस्ते {{name}}, आपके {{type}} में दिनांक {{date}} को शामिल होने का धन्यवाद। हमें आशा है आपको अच्छा लगा। हमारी योजनाओं के बारे में जानने या अगला सत्र बुक करने के लिए यहाँ उत्तर दें।',
    },
  },
};

// --- home and auto service visit ----------------------------------------------------------------------------------------------------

const SERVICE: Record<string, PackStepData['text']> = {
  confirmation: {
    en: {
      subject: 'Your {{type}} is booked',
      email:
        'Hi {{name}},\n\nYour {{type}} is booked for {{date}} at {{time}}.\n\nOur team will visit: {{location}}\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}\n\nThank you.',
      wa: 'Hi {{name}}, your {{type}} is booked for {{date}} at {{time}}. Our team will visit {{location}}. Thank you.',
    },
    hi: {
      subject: 'आपका {{type}} बुक हो गया है',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} {{date}} को {{time}} बजे के लिए बुक हो गया है।\n\nहमारी टीम यहाँ आएगी: {{location}}\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}\n\nधन्यवाद।',
      wa: 'नमस्ते {{name}}, आपका {{type}} दिनांक {{date}} को {{time}} बजे के लिए बुक हो गया है। हमारी टीम {{location}} पर आएगी। धन्यवाद।',
    },
  },
  day: {
    en: {
      subject: 'Reminder: your {{type}} is on {{date}}',
      email:
        'Hi {{name}},\n\nA reminder about your {{type}} on {{date}} at {{time}}.\n\nNeed to change it? Reschedule or cancel here: {{manage_link}}',
      wa: 'Hi {{name}}, a reminder: your {{type}} is on {{date}} at {{time}}. Please confirm, reschedule or cancel using the buttons below.',
    },
    hi: {
      subject: 'याद दिलाना: आपका {{type}} {{date}} को है',
      email:
        'नमस्ते {{name}},\n\nआपके {{type}} की याद दिलाना: {{date}} को {{time}} बजे।\n\nबदलाव करना है? यहाँ समय बदलें या रद्द करें: {{manage_link}}',
      wa: 'नमस्ते {{name}}, याद दिलाना: आपका {{type}} दिनांक {{date}} को {{time}} बजे है। कृपया नीचे दिए बटनों से पुष्टि करें, समय बदलें या रद्द करें।',
    },
  },
  twoHours: {
    en: {
      subject: 'Our team arrives soon for your {{type}}',
      email:
        'Hi {{name}},\n\nYour {{type}} is today, {{date}}, in the time window starting {{time}}.\n\nWe will arrive at: {{location}}\n\nPlease keep access ready.',
      wa: 'Hi {{name}}, your {{type}} is today, {{date}}, in the time window starting {{time}}. We will arrive at {{location}}. Please keep access ready.',
    },
    hi: {
      subject: 'आपके {{type}} के लिए हमारी टीम जल्द पहुँचेगी',
      email:
        'नमस्ते {{name}},\n\nआपका {{type}} आज, {{date}} को, {{time}} से शुरू होने वाली समय-सीमा में है।\n\nहम यहाँ पहुँचेंगे: {{location}}\n\nकृपया प्रवेश की व्यवस्था रखें।',
      wa: 'नमस्ते {{name}}, आपका {{type}} आज, {{date}} को, {{time}} से शुरू होने वाली समय-सीमा में है। हम {{location}} पर पहुँचेंगे। कृपया प्रवेश की व्यवस्था रखें।',
    },
  },
  noShow: {
    en: {
      subject: 'We could not complete your visit',
      email:
        'Hi {{name}},\n\nOur team could not complete your {{type}} on {{date}} at {{time}}.\n\nReply to this email and we will arrange a new visit.',
      wa: 'Hi {{name}}, our team could not complete your {{type}} on {{date}} at {{time}}. Reply here and we will arrange a new visit.',
    },
    hi: {
      subject: 'हम आपकी विज़िट पूरी नहीं कर पाए',
      email:
        'नमस्ते {{name}},\n\nहमारी टीम {{date}} को {{time}} बजे आपका {{type}} पूरा नहीं कर पाई।\n\nइस ईमेल का उत्तर दें, हम नई विज़िट तय कर देंगे।',
      wa: 'नमस्ते {{name}}, हमारी टीम आपका {{type}} दिनांक {{date}} को {{time}} बजे पूरा नहीं कर पाई। यहाँ उत्तर दें, हम नई विज़िट तय कर देंगे।',
    },
  },
  afterVisit: {
    en: {
      subject: 'How did we do?',
      email:
        'Hi {{name}},\n\nThank you for choosing us for your {{type}} on {{date}}.\n\nWe would value your feedback: reply to this email and tell us how the visit went.',
      wa: 'Hi {{name}}, thank you for choosing us for your {{type}} on {{date}}. We would value your feedback: reply here and tell us how the visit went.',
    },
    hi: {
      subject: 'हमारी सेवा कैसी रही?',
      email:
        'नमस्ते {{name}},\n\n{{date}} को आपके {{type}} के लिए हमें चुनने का धन्यवाद।\n\nआपकी राय हमारे लिए महत्वपूर्ण है: इस ईमेल का उत्तर देकर बताइए कि विज़िट कैसी रही।',
      wa: 'नमस्ते {{name}}, आपके {{type}} के लिए दिनांक {{date}} को हमें चुनने का धन्यवाद। आपकी राय हमारे लिए महत्वपूर्ण है: यहाँ उत्तर देकर बताइए कि विज़िट कैसी रही।',
    },
  },
};

// --- the packs --------------------------------------------------------------------------------------------------------------------------

export const PACKS: readonly PackData[] = [
  {
    key: 'clinic',
    name: 'Clinic and doctor',
    description:
      'Confirmation, a 24 hour reminder with Confirm, Reschedule and Cancel buttons, a 2 hour reminder and a no-show message. The after-visit message and a recall to book again are included and OFF. Messages say "your appointment" and never name the service.',
    serviceLabel: MEDICAL_LABEL,
    steps: medicalSteps(90),
  },
  {
    key: 'dental',
    name: 'Dental',
    description:
      'The clinic sequence plus a 180 day recall to book the next check-up (OFF until you switch it on). Messages say "your appointment" and never name the treatment.',
    serviceLabel: MEDICAL_LABEL,
    steps: medicalSteps(180),
  },
  {
    key: 'salon_spa',
    name: 'Salon and spa',
    description:
      'Confirmation, a 24 hour reminder with buttons, a 2 hour reminder and a thank-you with a request for feedback after the visit. A 35 day rebook message is included and OFF.',
    serviceLabel: null,
    steps: [
      confirmation(SALON.confirmation!),
      day(SALON.day!),
      twoHours(SALON.twoHours!),
      afterVisit(SALON.afterVisit!),
      rebook(35, SALON.rebook!, false),
    ],
  },
  {
    key: 'property_visit',
    name: 'Property visit',
    description:
      'Confirmation with the address, a map link and your agent (email), a 24 hour reminder with buttons, a 2 hour reminder with the location, a no-show message and a feedback request after the visit.',
    serviceLabel: null,
    steps: [
      confirmation(PROPERTY.confirmation!),
      day(PROPERTY.day!),
      twoHours(PROPERTY.twoHours!),
      noShow(PROPERTY.noShow!),
      afterVisit(PROPERTY.afterVisit!),
    ],
  },
  {
    key: 'sales_meeting',
    name: 'Sales meeting, demo or consultation',
    description:
      'Confirmation with the join link, a 24 hour reminder with buttons, a 15 minute reminder with the join link (online meetings only), a no-show message and the next steps after the meeting.',
    serviceLabel: null,
    steps: [
      confirmation(SALES.confirmation!),
      day(SALES.day!),
      step({ stepKind: 'reminder_15m', offsetMinutes: 15, onlineOnly: true, text: SALES.fifteen! }),
      noShow(SALES.noShow!),
      afterVisit(SALES.afterVisit!),
    ],
  },
  {
    key: 'fitness_wellness',
    name: 'Fitness and wellness studio',
    description:
      'Confirmation, a 24 hour reminder with buttons, a 2 hour reminder, a no-show message and a follow-up after a trial session.',
    serviceLabel: null,
    steps: [
      confirmation(FITNESS.confirmation!),
      day(FITNESS.day!),
      twoHours(FITNESS.twoHours!),
      noShow(FITNESS.noShow!),
      afterVisit(FITNESS.afterVisit!),
    ],
  },
  {
    key: 'home_auto_service',
    name: 'Home and auto service visit',
    description:
      'Confirmation, a 24 hour reminder with buttons, a message with the arrival window on the day, a no-show message and a feedback request after the visit.',
    serviceLabel: null,
    steps: [
      confirmation(SERVICE.confirmation!),
      day(SERVICE.day!),
      twoHours(SERVICE.twoHours!),
      noShow(SERVICE.noShow!),
      afterVisit(SERVICE.afterVisit!),
    ],
  },
];

export const packByKey = (key: string): PackData | undefined => PACKS.find((p) => p.key === key);

/** The WhatsApp template name of a pack step: `appt_<pack>_<step>_<lang>`. Created once per workspace and shared by every booking type. */
export const waTemplateNameOf = (
  pack: ReminderPackKey,
  step: BookingReminderStepKind,
  language: ReminderPackLanguage,
): string => `appt_${pack}_${step}_${language}`;

/** The library key of a pack step's message (one per channel and language); unique per workspace. */
export const libraryKeyOf = (pack: ReminderPackKey, step: BookingReminderStepKind): string =>
  `pack:${pack}:${step}`;
