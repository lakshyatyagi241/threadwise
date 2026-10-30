import {
  countPlaceholders,
  placeholderGaps,
  tokensOf,
  type VariableMap,
} from './template-variables';
import { normalizeTemplateName, type TemplateButton, type TemplateCard } from './template-payload';

/**
 * Predicts Meta's rejections before a submit (TW-TPL-023), so failed submissions do not lower the WABA's quality score.
 * Errors block; warnings are shown. Pure rules engine returning structured issues the form can reuse for instant feedback.
 */

export interface LintIssue {
  code: string;
  severity: 'error' | 'warning';
  field: 'name' | 'language' | 'header' | 'body' | 'footer' | 'buttons' | 'cards' | 'template';
  message: string;
}

export interface LintInput {
  name: string;
  language?: string | null;
  /** MARKETING | UTILITY | AUTHENTICATION, any case. */
  metaCategory?: string | null;
  templateType?: string | null;
  header?: string | null;
  /** Set when the header is media. */
  attachmentType?: string | null;
  hasHeaderFile?: boolean;
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[] | null;
  /** `templateType: 'carousel'` only. */
  cards?: TemplateCard[] | null;
  /** `templateType: 'lto'` only. */
  limitedOffer?: { text: string; hasExpiration?: boolean } | null;
  variableMap?: VariableMap | null;
  parameterFormat?: 'POSITIONAL' | 'NAMED' | null;
}

const TRIGGER_PHRASES = [
  'guaranteed',
  '100%',
  'act now',
  'click here',
  'limited time only',
  'winner',
  'congratulations you have won',
  'free money',
  'claim now',
  'risk free',
  'no obligation',
  'lifetime deal',
  "don't miss",
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const BUTTON_LIMIT = {
  QUICK_REPLY: 10,
  URL: 2,
  PHONE_NUMBER: 1,
  COPY_CODE: 1,
  FLOW: 1,
  CATALOG: 1,
} as Record<string, number>;

export function lintTemplate(t: LintInput): LintIssue[] {
  const out: LintIssue[] = [];
  const e = (code: string, field: LintIssue['field'], message: string) =>
    out.push({ code, severity: 'error', field, message });
  const w = (code: string, field: LintIssue['field'], message: string) =>
    out.push({ code, severity: 'warning', field, message });
  const category = (t.metaCategory ?? '').toUpperCase();
  const auth = category === 'AUTHENTICATION' || t.templateType === 'auth';

  // Name and language
  if (!t.name.trim()) e('name_empty', 'name', 'Template name is required.');
  else {
    const slug = normalizeTemplateName(t.name);
    if (slug === 'untitled_template' && !/[a-z0-9]/i.test(t.name))
      e('name_invalid', 'name', 'Template name needs letters or digits.');
    if (slug.length > 512) e('name_long', 'name', 'Template name is longer than 512 characters.');
  }
  if (t.language && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language))
    e(
      'language_invalid',
      'language',
      `Language "${t.language}" is not a Meta language code (for example en_US).`,
    );

  if (auth) return out;

  // Body
  const body = t.body ?? '';
  if (!body.trim()) e('body_empty', 'body', 'Body text is required.');
  if (body.length > 1024) e('body_too_long', 'body', 'Body is longer than 1024 characters.');
  else if (body.length > 800)
    w(
      'body_long',
      'body',
      'Body is over 800 characters; shorter templates get approved more often.',
    );
  if (/\n{3,}/.test(body))
    w('body_newlines', 'body', 'Body has three or more line breaks in a row.');
  if (/\b[A-Z]{5,}\b/.test(body))
    w('body_caps', 'body', 'Body has an ALL-CAPS word; Meta can treat it as spam.');
  if (category === 'MARKETING' && countPlaceholders(body) === 0)
    w(
      'marketing_no_variable',
      'body',
      'A marketing template with no variable is more likely to be recategorised.',
    );
  if (/^\s*\{\{[^}]+\}\}/.test(body))
    w('body_starts_variable', 'body', 'Body starts with a variable.');
  if (/\{\{[^}]+\}\}\s*$/.test(body)) w('body_ends_variable', 'body', 'Body ends with a variable.');
  if (/\{\{[^}]+\}\}\s*\{\{[^}]+\}\}/.test(body))
    e('adjacent_variables', 'body', 'Two variables are next to each other. Put text between them.');
  if (/ {4,}/.test(body)) e('body_spaces', 'body', 'Body has four or more spaces in a row.');
  if (/\t/.test(body)) e('body_tab', 'body', 'Body contains a tab character.');
  if ((body.match(EMOJI) ?? []).length > 10) {
    if (category === 'MARKETING')
      e('emoji_marketing', 'body', 'More than 10 emojis in a marketing template is a hard reject.');
    else w('emoji_many', 'body', 'More than 10 emojis; Meta may reject it.');
  }

  // Header
  const media = (t.attachmentType ?? '').toLowerCase();
  if (media && media !== 'none' && media !== 'location' && !t.hasHeaderFile)
    e('header_media_missing', 'header', 'A media header needs a file.');
  if (t.header) {
    if (t.header.length > 60)
      e('header_long', 'header', 'Header text is longer than 60 characters.');
    if (countPlaceholders(t.header) > 1)
      e('header_variables', 'header', 'A header can have only one variable.');
  }

  // Footer
  if (t.footer) {
    if (t.footer.length > 60) e('footer_long', 'footer', 'Footer is longer than 60 characters.');
    if (/\{\{[^}]+\}\}/.test(t.footer))
      e('footer_variable', 'footer', 'A footer cannot contain a variable.');
  }

  // Placeholders (header and body together)
  const hay = `${t.header ?? ''}\n${body}`;
  const tokens = tokensOf(hay);
  if ((t.parameterFormat ?? 'POSITIONAL') === 'POSITIONAL') {
    if (tokens.some((x) => !/^\d+$/.test(x)))
      e(
        'named_in_positional',
        'body',
        'Variables must be numbered ({{1}}, {{2}}) in a positional template.',
      );
    for (const [field, text] of [
      ['header', t.header ?? ''],
      ['body', body],
    ] as const) {
      const gaps = placeholderGaps(text);
      if (gaps.length)
        e(
          'placeholder_gap',
          field,
          `Variables must run 1, 2, 3 with no gaps. Found ${gaps.map((n) => `{{${n}}}`).join(', ')}.`,
        );
    }
    const examples = (t.variableMap?.body ?? []).filter((s) => s.example?.trim()).length;
    const distinct = tokensOf(body).length;
    if (distinct > 0 && examples < distinct)
      w(
        'examples_missing',
        'body',
        'Meta auto-rejects templates without a sample value for every variable.',
      );
  } else if (tokens.some((x) => !/^[a-z][a-z0-9_]*$/.test(x))) {
    e(
      'named_invalid',
      'body',
      'Named variables must be lowercase letters, digits and underscores, starting with a letter.',
    );
  }

  if (t.templateType === 'carousel') {
    lintCarousel(t.cards ?? [], e);
    if (category !== 'MARKETING')
      e(
        'carousel_category',
        'template',
        'A carousel template must be in the Marketing category; Meta does not allow it in any other.',
      );
  }

  if (t.templateType === 'lto') lintOffer(t, category, e);

  // Buttons
  const buttons = t.buttons ?? [];
  if (buttons.length > 10) e('buttons_many', 'buttons', 'A template can have at most 10 buttons.');
  const counts: Record<string, number> = {};
  for (const b of buttons) {
    const type = b.type.toUpperCase();
    counts[type] = (counts[type] ?? 0) + 1;
    if (type !== 'COPY_CODE' && type !== 'FLOW' && (!b.text || b.text.length > 25))
      e('button_text', 'buttons', 'Button text is required and at most 25 characters.');
    if (type === 'FLOW' && !b.flow_name && !b.flow_json && !/^\d+$/.test(String(b.flow_id ?? '')))
      e('flow_id', 'buttons', 'A form button needs the numeric id of a WhatsApp Flow.');
    if (type === 'FLOW' && b.flow_action !== 'data_exchange' && !b.navigate_screen && !b.flow_json)
      e('flow_screen', 'buttons', 'A form button needs the screen it opens on.');
    if (type === 'QUICK_REPLY' && /\{\{[^}]+\}\}/.test(b.text ?? ''))
      e('button_variable', 'buttons', 'Quick reply text cannot contain a variable.');
    if (type === 'URL' && countPlaceholders(b.url ?? '') > 1)
      e('url_variables', 'buttons', 'A URL button can have only one variable.');
    // Meta: a URL button's variable is appended at the end of the address, and the address (and its example) is at most 2000 characters.
    if (
      type === 'URL' &&
      countPlaceholders(b.url ?? '') === 1 &&
      !/\{\{[^}]+\}\}$/.test((b.url ?? '').trim())
    )
      e(
        'url_variable_position',
        'buttons',
        'The variable of a URL button must be at the very end of the address.',
      );
    if (type === 'URL' && (b.url ?? '').length > 2000)
      e('url_long', 'buttons', 'A URL button address can have at most 2000 characters.');
    if (type === 'PHONE_NUMBER' && (b.phone_number ?? '').length > 20)
      e('phone_long', 'buttons', 'A phone number button can have at most 20 characters.');
    if (type === 'COPY_CODE') {
      const example = Array.isArray(b.example) ? b.example[0] : b.example;
      if (typeof example === 'string' && example.length > 20)
        e(
          'copy_code_long',
          'buttons',
          'The example code of a copy-code button can have at most 20 characters.',
        );
    }
  }
  for (const [type, n] of Object.entries(counts))
    if (BUTTON_LIMIT[type] && n > BUTTON_LIMIT[type]!)
      e(
        'button_count',
        'buttons',
        `At most ${BUTTON_LIMIT[type]} ${type.replace('_', ' ').toLowerCase()} button(s).`,
      );
  if (buttons.length > 1 && buttons.some((b) => b.type.toUpperCase() === 'CATALOG'))
    e('catalog_alone', 'buttons', 'A catalog button cannot be combined with other buttons.');
  const qr = buttons.map((b) => b.type.toUpperCase() === 'QUICK_REPLY');
  const first = qr.indexOf(true);
  const last = qr.lastIndexOf(true);
  const contiguous = first < 0 || !qr.slice(first, last + 1).includes(false);
  const atEdge = first < 0 || first === 0 || last === qr.length - 1;
  if (!contiguous || !atEdge)
    e(
      'quick_reply_position',
      'buttons',
      'Quick replies must be together, at the start or the end of the buttons.',
    );

  // Trigger phrases
  // Each phrase is reported under the part of the template that holds it, so removing it from there clears it (a phrase left in the
  // header or footer used to be reported under the body, where it could not be found). A curly apostrophe counts as a straight one.
  const plain = (v: string | null | undefined) => (v ?? '').replace(/[‘’]/g, "'").toLowerCase();
  for (const [field, value] of [
    ['body', body],
    ['header', t.header],
    ['footer', t.footer],
  ] as const) {
    const text = plain(value);
    for (const phrase of TRIGGER_PHRASES)
      if (text.includes(phrase))
        w('trigger_phrase', field, `"${phrase}" is a phrase Meta's review often flags.`);
  }

  return out;
}

/** Meta's limited-time-offer rules: Marketing only, a picture or video header, a heading of up to 16 characters, a short body, and a copy-code or website button. */
function lintOffer(
  t: LintInput,
  category: string,
  e: (code: string, field: LintIssue['field'], message: string) => void,
): void {
  const text = (t.limitedOffer?.text ?? '').trim();
  if (category !== 'MARKETING')
    e('lto_category', 'template', 'A limited-time offer must be a Marketing template.');
  if (!text) e('lto_text', 'template', 'The offer needs a heading, such as "Expiring offer!".');
  else if (text.length > 16)
    e('lto_text_long', 'template', 'The offer heading can have at most 16 characters.');
  const media = (t.attachmentType ?? '').toLowerCase();
  if (media !== 'image' && media !== 'video')
    e('lto_header', 'header', 'A limited-time offer needs a picture or video header.');
  if (t.body.length > 600) e('lto_body', 'body', 'The body can have at most 600 characters.');
  const types = (t.buttons ?? []).map((b) => b.type.toUpperCase());
  if (!types.includes('COPY_CODE') && !types.includes('URL'))
    e('lto_buttons', 'buttons', 'Add a copy-code or a website button to the offer.');
  if (types.some((x) => x !== 'COPY_CODE' && x !== 'URL'))
    e(
      'lto_button_type',
      'buttons',
      'A limited-time offer allows only copy-code and website buttons.',
    );
}

/** Meta's carousel rules: 2 to 10 cards, every card a picture (or every card a video) with a short text, and the same buttons on every card. */
function lintCarousel(
  cards: TemplateCard[],
  e: (code: string, field: LintIssue['field'], message: string) => void,
): void {
  if (cards.length < 2) e('cards_few', 'cards', 'A carousel needs at least 2 cards.');
  if (cards.length > 10) e('cards_many', 'cards', 'A carousel can have at most 10 cards.');
  const formats = new Set(cards.map((c) => String(c.format ?? 'image').toLowerCase()));
  if (formats.size > 1)
    e(
      'cards_format',
      'cards',
      'Every card must use the same kind of file: all pictures or all videos.',
    );
  const shape = (c: TemplateCard) => (c.buttons ?? []).map((b) => b.type.toUpperCase()).join(',');
  if (new Set(cards.map(shape)).size > 1)
    e(
      'cards_buttons',
      'cards',
      'Every card must have the same buttons (same number and same types).',
    );
  cards.forEach((c, i) => {
    const n = i + 1;
    if (!c.headerHandle && !c.headerSampleUrl)
      e('card_file', 'cards', `Card ${n} needs a picture or video.`);
    const body = (c.body ?? '').trim();
    if (!body) e('card_body', 'cards', `Card ${n} needs some text.`);
    else if (body.length > 160)
      e('card_body_long', 'cards', `Card ${n}'s text is longer than 160 characters.`);
    if (/\{\{[^}]+\}\}/.test(c.body ?? ''))
      e('card_variable', 'cards', `Card ${n}'s text cannot hold a variable yet.`);
    if ((c.buttons ?? []).length === 0)
      e('card_buttons_none', 'cards', `Card ${n} needs at least one button.`);
    (c.buttons ?? []).forEach((b) => {
      const type = b.type.toUpperCase();
      if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type))
        e(
          'card_button_type',
          'cards',
          `Card ${n}: a card button can be a quick reply, a link or a phone number.`,
        );
      if (!b.text || b.text.length > 25)
        e(
          'card_button_text',
          'cards',
          `Card ${n}: button text is required and at most 25 characters.`,
        );
    });
  });
}

export const hasErrors = (issues: LintIssue[]) => issues.some((i) => i.severity === 'error');
