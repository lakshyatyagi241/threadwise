import { isHelpAgentNavBlocked } from '@crm/contracts';

/**
 * Which clicks the Help assistant may not make without asking (docs/specs/help-agent-assistant.md section 6.2). Pure DOM reads: given the
 * element the model chose, say whether the click is safe, needs the person's yes, or is not allowed at all. Over-asking costs one extra
 * click; under-asking costs a sent message, so every doubt resolves to "ask".
 */

export type RiskReason =
  | 'marked'
  | 'submit'
  | 'delete'
  | 'send'
  | 'pay'
  | 'invite'
  | 'connect'
  | 'access'
  | 'settings'
  | 'toggle'
  | 'dialog'
  | 'signout'
  | 'external'
  | 'blocked_route'
  | 'new_tab'
  | 'download'
  | 'bad_scheme';

export interface Verdict {
  level: 'safe' | 'confirm' | 'blocked';
  reason?: RiskReason;
  /** What the control says, short, for the confirmation card and the step list. */
  label: string;
}

/** Lower case, no Arabic diacritics or tatweel, one alef and one yeh/heh form, single spaces. */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

type Rule = { reason: RiskReason; en: RegExp; ar: string[] };

/**
 * Order matters: the first rule that matches names the reason on the card. Arabic words are matched as whole words (an optional
 * article or conjunction prefix is allowed: "الحفظ", "وحفظ"), phrases as substrings; they are written here in any spelling, the
 * matcher normalizes both sides.
 */
const RULES: Rule[] = [
  {
    reason: 'signout',
    en: /\b(log ?out|sign ?out)\b/,
    ar: ['تسجيل الخروج', 'خروج'],
  },
  {
    reason: 'delete',
    en: /\b(delet\w*|remov\w*|eras\w*|discard\w*|destroy\w*|wipe\w*|trash|revok\w*|unlink\w*|archiv\w*|purge\w*|clear all|reset (password|data|workspace|account|everything))\b|\bcancel (my |the |this |your )?(subscription|plan|order|booking|appointment|campaign|broadcast|invoice|membership|account)\b/,
    ar: [
      'حذف',
      'احذف',
      'ازالة',
      'ازل',
      'مسح',
      'امسح',
      'الغاء الربط',
      'الغاء الاشتراك',
      'الغاء الحجز',
      'الغاء الطلب',
      'الغاء الحملة',
      'سحب الصلاحية',
      'ارشفة',
      'اعادة تعيين',
    ],
  },
  {
    // A verb that changes who can do what, or a secret, applied to the thing: "Change role", "Regenerate API key". The bare nouns are
    // menu words and tab names ("Billing", "Security") and only count for a dropdown (see classifySelect).
    reason: 'access',
    en: /\b(chang\w*|reset|generat\w*|regenerat\w*|rotat\w*|grant|assign\w*|updat\w*|manage|set|save|add|create|new|copy|reveal|make|transfer)\s+(\w+\s+){0,2}(roles?|permissions?|billing|passwords?|api ?keys?|tokens?|secrets?|owner(ship)?|two.?factor|2fa|payment (method|details)|admin)\b/,
    ar: [
      'تغيير الدور',
      'تغيير الصلاحيات',
      'تغيير كلمة المرور',
      'تعيين دور',
      'منح صلاحية',
      'نقل الملكية',
      'انشاء مفتاح',
      'انشاء رمز',
      'اعادة تعيين كلمة المرور',
      'تغيير الفوترة',
      'جعله مديرا',
    ],
  },
  {
    reason: 'send',
    en: /\b(send\w*|resend|publish\w*|post|broadcast\w*|launch\w*|schedul\w*|go live|deploy\w*|run now|start (now|sending|campaign|broadcast|run|flow|call)|dispatch|notify|email blast)\b/,
    ar: [
      'ارسال',
      'ارسل',
      'نشر',
      'انشر',
      'بث',
      'اطلاق',
      'اطلق',
      'جدولة',
      'جدول',
      'ابدا الارسال',
      'بدء الارسال',
      'بدء الحملة',
      'ابدا الحملة',
    ],
  },
  {
    reason: 'pay',
    en: /\b(pay\w*|purchas\w*|buy|(chang\w*|switch) (my |the |your )?plan|check ?out|subscribe|upgrade|downgrade|top ?-?up|add funds|recharge|renew\w*|transfer\w*|withdraw\w*|refund\w*|charge\w*|place order|spend)\b/,
    ar: [
      'دفع',
      'ادفع',
      'شراء',
      'اشتر',
      'اشتراك',
      'اشترك',
      'ترقية',
      'ارتقاء',
      'شحن',
      'اشحن',
      'تجديد',
      'جدد',
      'تحويل',
      'حول',
      'سحب',
      'استرداد',
      'اتمام الطلب',
    ],
  },
  {
    reason: 'invite',
    en: /\b(invit\w*|add (a )?(member|user|teammate|agent|admin)|share (with|access))\b/,
    ar: ['دعوة', 'ادع', 'ادعو', 'اضافة عضو', 'اضافة مستخدم', 'مشاركة'],
  },
  {
    reason: 'connect',
    en: /\b(connect\w*|disconnect\w*|authori[sz]e\w*|allow access|install\w*|uninstall\w*|integrat\w*|pair|link (account|number|device|channel)|log ?in with)\b/,
    ar: [
      'ربط',
      'اربط',
      'فصل',
      'افصل',
      'اتصل',
      'تفويض',
      'تثبيت',
      'ثبت',
      'الغاء التثبيت',
      'تكامل',
      'اقتران',
      'السماح بالوصول',
    ],
  },
  {
    reason: 'submit',
    en: /\b(save\w*|submit\w*|confirm\w*|finish|apply changes|update (settings|profile|plan|details)|accept|agree|approve\w*|reject\w*|import\w*|export\w*|upload\w*|download\w*)\b/,
    ar: [
      'حفظ',
      'احفظ',
      'تاكيد',
      'اكد',
      'انهاء',
      'تحديث الاعدادات',
      'قبول',
      'اقبل',
      'موافق',
      'اعتماد',
      'اعتمد',
      'رفض',
      'ارفض',
      'استيراد',
      'استورد',
      'تصدير',
      'صدر',
      'رفع',
      'ارفع',
      'تنزيل',
      'تحميل',
    ],
  },
  {
    reason: 'settings',
    en: /\b(enable\w*|disable\w*|turn (on|off)|activat\w*|deactivat\w*|pause\w*|resume|stop|suspend\w*|unsubscribe|opt ?(in|out)|block|unblock|mute|set as default|make default)\b/,
    ar: [
      'تفعيل',
      'فعل',
      'تعطيل',
      'عطل',
      'ايقاف',
      'اوقف',
      'استئناف',
      'تشغيل',
      'شغل',
      'حظر',
      'احظر',
      'الغاء الحظر',
      'كتم',
      'تعيين كافتراضي',
      'ايقاف مؤقت',
    ],
  },
];

const NEUTRAL_EN =
  /^(cancel|close|back|dismiss|no|no thanks|not now|skip|next|previous|prev|search|filter|filters|apply filters?|clear filters?|reset filters?|clear search|view|show|hide|open|expand|collapse|more|less|got it|learn more|edit|details|refresh|reload|ask|help)$/;
const NEUTRAL_AR = new Set(
  [
    'الغاء',
    'اغلاق',
    'اغلق',
    'رجوع',
    'السابق',
    'التالي',
    'تخطي',
    'لا',
    'ليس الان',
    'بحث',
    'ابحث',
    'تصفية',
    'مسح التصفية',
    'عرض',
    'اظهار',
    'اخفاء',
    'فتح',
    'افتح',
    'المزيد',
    'اقل',
    'حسنا',
    'فهمت',
    'تعديل',
    'التفاصيل',
    'تحديث',
    'مساعدة',
  ].map((w) => normalizeLabel(w)),
);

/** Labels that only move around or look: never the reason to ask on a submit button or in a dialog. */
export function isNeutralLabel(norm: string): boolean {
  const bare = norm.replace(/[.…!?:؟]+$/g, '').trim();
  return bare === '' ? false : NEUTRAL_EN.test(bare) || NEUTRAL_AR.has(bare);
}

const AR_PREFIX = /^(وال|بال|كال|فال|لل|ال|و|ب|ل|ف)/;

function arabicMatch(norm: string, wordRaw: string): boolean {
  const word = normalizeLabel(wordRaw);
  if (word.includes(' ')) return norm.includes(word);
  return norm.split(' ').some((token) => {
    if (token === word) return true;
    const stripped = token.replace(AR_PREFIX, '');
    return stripped === word;
  });
}

/** Which kind of risk a label names, or null. */
export function riskOfLabel(raw: string): RiskReason | null {
  const norm = normalizeLabel(raw);
  if (norm === '') return null;
  for (const rule of RULES) {
    if (rule.en.test(norm)) return rule.reason;
    if (rule.ar.some((w) => arabicMatch(norm, w))) return rule.reason;
  }
  return null;
}

const CONTROL =
  'button, a, [role="button"], [role="menuitem"], [role="switch"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], input, summary, label, select';

/** The control a click lands on: the element itself or its closest clickable ancestor. */
export function controlOf(el: Element): Element {
  return el.closest(CONTROL) ?? el;
}

const FIELD = /^(select|textarea)$/i;
const isField = (c: Element): boolean =>
  FIELD.test(c.tagName) ||
  (c.tagName === 'INPUT' &&
    !['submit', 'button', 'image', 'reset'].includes(
      ((c as HTMLInputElement).type ?? '').toLowerCase(),
    ));

/**
 * What the control says. A button says its aria-label, its text, its value or its title. A field says its aria-label, the label bound
 * to it, its placeholder or its title: never the text of its options or its current value.
 */
export function labelOf(el: Element): string {
  const c = controlOf(el);
  const bound = c.id ? document.querySelector(`label[for="${CSS.escape(c.id)}"]`)?.textContent : '';
  const wrapping = c.closest('label')?.textContent;
  const text = isField(c)
    ? c.getAttribute('aria-label') ||
      bound ||
      wrapping ||
      c.getAttribute('placeholder') ||
      c.getAttribute('title') ||
      ''
    : c.getAttribute('aria-label') ||
      (c as HTMLElement).innerText ||
      c.textContent ||
      (c as HTMLInputElement).value ||
      c.getAttribute('title') ||
      bound ||
      wrapping ||
      c.getAttribute('placeholder') ||
      '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function markedHigh(el: Element): boolean {
  for (
    let node: Element | null = el, depth = 0;
    node && depth < 4;
    node = node.parentElement, depth++
  ) {
    if (node.getAttribute('data-agent-risk') === 'high') return true;
  }
  return false;
}

function isRealLink(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href');
  if (href === null || href === '' || href.startsWith('#')) return false;
  return a.getAttribute('role') !== 'button';
}

function linkVerdict(a: HTMLAnchorElement, origin: string, label: string): Verdict | null {
  const raw = a.getAttribute('href') ?? '';
  if (a.hasAttribute('download')) return { level: 'blocked', reason: 'download', label };
  if (a.target === '_blank') return { level: 'blocked', reason: 'new_tab', label };
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return { level: 'blocked', reason: 'bad_scheme', label };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { level: 'blocked', reason: 'bad_scheme', label };
  }
  if (url.origin !== origin) return { level: 'blocked', reason: 'external', label };
  if (isHelpAgentNavBlocked(url.pathname))
    return { level: 'blocked', reason: 'blocked_route', label };
  return null;
}

function isSearchForm(form: Element | null): boolean {
  if (!form) return false;
  if (form.getAttribute('role') === 'search') return true;
  const fields = form.querySelectorAll('input:not([type=hidden]), textarea, select');
  return fields.length === 1 && (fields[0] as HTMLInputElement).type === 'search';
}

/** The verdict for a click on `el`. `origin` is the page's origin (injected so tests need no location). */
export function classifyClick(el: Element, origin: string = window.location.origin): Verdict {
  const control = controlOf(el);
  const label = labelOf(control);
  const norm = normalizeLabel(label);

  // A real link only navigates: where it leads decides (the page it opens asks again before it does anything).
  const anchor = control.closest('a');
  if (anchor && isRealLink(anchor as HTMLAnchorElement)) {
    const bad = linkVerdict(anchor as HTMLAnchorElement, origin, label);
    if (bad) return bad;
    if (markedHigh(control)) return { level: 'confirm', reason: 'marked', label };
    if (riskOfLabel(label) === 'signout') return { level: 'confirm', reason: 'signout', label };
    return { level: 'safe', label };
  }

  if (markedHigh(control)) return { level: 'confirm', reason: 'marked', label };

  const named = riskOfLabel(label);
  if (named) return { level: 'confirm', reason: named, label };

  // Switches persist at once on a settings screen.
  const role = control.getAttribute('role');
  const typeAttr = (control.getAttribute('type') ?? '').toLowerCase();
  if (
    role === 'switch' ||
    (control.tagName === 'INPUT' && typeAttr === 'checkbox' && control.closest('[role="switch"]'))
  ) {
    return { level: 'confirm', reason: 'toggle', label };
  }

  const isButtonLike =
    control.tagName === 'BUTTON' ||
    role === 'button' ||
    (control.tagName === 'INPUT' && ['submit', 'image', 'button'].includes(typeAttr));

  // Anything in a confirmation dialog other than a neutral dismissal is the confirmation itself.
  if (control.closest('[role="alertdialog"]') && !isNeutralLabel(norm)) {
    return { level: 'confirm', reason: 'dialog', label };
  }

  // A button in a modal's footer that is not a dismissal is its primary action (the form may sit outside the footer).
  if (
    isButtonLike &&
    control.closest('[role="dialog"], dialog[open], [aria-modal="true"]') &&
    !isNeutralLabel(norm)
  ) {
    return { level: 'confirm', reason: 'dialog', label };
  }

  const inForm = control.closest('form');
  const submits =
    inForm !== null &&
    isButtonLike &&
    (typeAttr === 'submit' ||
      typeAttr === 'image' ||
      (control.tagName === 'BUTTON' && typeAttr === ''));
  if (submits && !isSearchForm(inForm) && !isNeutralLabel(norm)) {
    return { level: 'confirm', reason: 'submit', label };
  }

  return { level: 'safe', label };
}

/** Fields the assistant never types into: the person types these themselves. */
const SENSITIVE_NAME =
  /(pass(word|wd|code)?\b|card|cvv|cvc|cvn|otp|one.?time|\bpin\b|secret|token|api.?key|\bssn\b|iban|routing|account.?number|security.?code|verification.?code|كلمة المرور|رمز التحقق|بطاقة|سري)/i;
const SENSITIVE_AUTOCOMPLETE = /(cc-|current-password|new-password|one-time-code)/i;

export function isSensitiveField(el: Element): boolean {
  const input = el as HTMLInputElement;
  if ((input.type ?? '').toLowerCase() === 'password') return true;
  if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') ?? '')) return true;
  const bound = el.id
    ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
    : null;
  const hay = [
    el.getAttribute('name'),
    el.id,
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    bound,
  ]
    .filter(Boolean)
    .join(' ');
  return SENSITIVE_NAME.test(hay);
}

const SELECT_RISK =
  /\b(roles?|permissions?|plan|billing|owner|access|status|visibility|default)\b|دور|صلاحي|خطة|الفوترة|مالك|الحالة/i;

/** A dropdown whose change may persist at once (a role, a plan, a status) is asked about like a click. */
export function classifySelect(el: Element): Verdict {
  const label = labelOf(el);
  if (markedHigh(el)) return { level: 'confirm', reason: 'marked', label };
  const hay = `${label} ${el.getAttribute('name') ?? ''} ${el.id}`;
  if (SELECT_RISK.test(hay)) return { level: 'confirm', reason: 'access', label };
  return { level: 'safe', label };
}
