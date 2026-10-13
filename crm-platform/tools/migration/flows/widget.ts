import { bool, isDeleted, primaryKey, redactText, sha256, str, type Doc } from '../util';
import type { Row, Soft } from '../transform/types';
import { WIDGET_CLOSED_DOMAIN, type FlowSettings } from './config';
import type { BotPlan, DocVerdict } from './plan';
import { clipChars, docKey, obj, s, wabooDate } from './rules';

/**
 * chatbots + chatbot_configuration + chatbot_theme -> ONE chatbot_widgets row (plus an ai_chat_assistants row when the AI part is
 * switched on), and faq_variations -> keyword_replies. Everything here is plain configuration: the AI keys (normalKey, openRouterKey)
 * are never read into a row, and the prompt goes through the shared text redaction of util.ts.
 *
 * SAFETY: a widget is imported PAUSED with an allow-list no site can match, and with a freshly generated embed token (the load
 * generates it, see load/flows.ts): the public routes answer 404 for a paused widget, and an empty allow-list would answer EVERY
 * origin. A keyword reply is imported with status false. The assistant is paused.
 */
export type FaqVerdict =
  | {
      kind: 'load';
      botId: string;
      qid: string | null;
      chunks: string[];
      phrases: number;
      droppedLong: number;
      commas: number;
    }
  | { kind: 'exclude' | 'quarantine'; code: string; reason: string };

export interface WidgetPlan {
  botId: string;
  verdict: { kind: 'load' } | { kind: 'exclude' | 'quarantine'; code: string; reason: string };
  row: Row | null;
  assistant: Row | null;
  soft: Soft[];
  configKey: string | null;
  themeKey: string | null;
}

export const KEYWORD_MAX = 255;

/** Chunks of ", "-joined phrases, each at most 255 characters (keyword_replies.keyword was VARCHAR(255)). */
export function chunkPhrases(phrases: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const p of phrases) {
    const next = cur === '' ? p : `${cur}, ${p}`;
    if (Array.from(next).length > KEYWORD_MAX && cur !== '') {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur !== '') out.push(cur);
  return out;
}

export function buildFaqPlan(a: {
  faqs: Doc[];
  bots: Map<string, BotPlan>;
  fallbackAt: string;
  setDoc: (d: Doc, v: DocVerdict) => void;
}): Map<string, FaqVerdict> {
  const out = new Map<string, FaqVerdict>();
  for (const d of a.faqs) {
    const key = docKey('faq_variations', d);
    const botId = str(d.botid);
    let v: FaqVerdict;
    if (botId === null) {
      v = { kind: 'quarantine', code: 'NO_BOT_ID', reason: 'the record has no botid' };
    } else if (a.bots.get(botId)?.verdict.kind !== 'load') {
      v = {
        kind: 'exclude',
        code: 'FLOW_NOT_LOADED',
        reason: 'its bot did not become a flow, so there is nothing for the reply to start',
      };
    } else {
      const seen = new Set<string>();
      const phrases: string[] = [];
      let droppedLong = 0;
      let commas = 0;
      const raw = Array.isArray(d.phrases)
        ? d.phrases
        : typeof d.phrases === 'string'
          ? [d.phrases]
          : [];
      for (const p of raw) {
        if (typeof p !== 'string') continue;
        let t = p.replace(/\s+/g, ' ').trim();
        if (t.includes(',')) {
          t = t.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
          commas++;
        }
        if (t === '') continue;
        if (Array.from(t).length > KEYWORD_MAX) {
          droppedLong++;
          continue;
        }
        if (seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        phrases.push(t);
      }
      v =
        phrases.length === 0
          ? { kind: 'exclude', code: 'NO_PHRASES', reason: 'the record holds no usable phrase' }
          : {
              kind: 'load',
              botId,
              qid: str(d.qid),
              chunks: chunkPhrases(phrases),
              phrases: phrases.length,
              droppedLong,
              commas,
            };
    }
    out.set(key, v);
  }
  return out;
}

// --- widgets --------------------------------------------------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const hex = (v: unknown): string | null =>
  typeof v === 'string' && HEX.test(v.trim()) && v.trim().length <= 16 ? v.trim() : null;
const url = (v: unknown): string | null =>
  typeof v === 'string' && /^https?:\/\/[^\s'"<>\\]{1,1000}$/i.test(v.trim()) ? v.trim() : null;
const text = (v: unknown, max: number): string | null => {
  const t = str(v);
  return t === null ? null : clipChars(t, max);
};

export const WIDGET_DEFAULTS = {
  button_color: '#075E54',
  header_title: 'Chat with us',
  header_bg: '#075E54',
  header_text_color: '#FFFFFF',
  message_bubble_color: '#FFFFFF',
  message_text_color: '#222222',
  body_bg_kind: 'color',
  body_bg_color: '#ECE5DD',
  auto_open: false,
  button_label: 'Start chat',
  action_button_bg: '#075E54',
  action_button_text_color: '#FFFFFF',
  collect_name: true,
  collect_email: false,
  collect_phone: false,
} as const;

/** Config keys that have a home in the widget / assistant row; every other key is NOT PRESENT (names are listed, never values). */
export const MAPPED_CONFIG_KEYS = new Set([
  '_id',
  'id',
  'created_time',
  'modified_time',
  'deleted_time',
  'whatsapp_prefilled_message_text',
  'prefilled_message_text',
  'welcome_message_text',
  'whatsapp_welcome_message_text',
  'cta_button_text',
  'whatsapp_cta_button_text',
  'subheader_text',
  'display_position',
  'desktop_display_position',
  'mobile_display_position',
  'desktop_side_margin',
  'desktop_bottom_margin',
  'mobile_side_margin',
  'mobile_bottom_margin',
  'company_logo',
  'avatar',
  'background_image',
  'desktop_auto_triggering',
  'ai_configuration',
  'modelName',
  'prompt',
  'temperature',
]);
export const MAPPED_THEME_KEYS = new Set([
  '_id',
  'id',
  'created_time',
  'modified_time',
  'deleted_time',
  'primary',
  'button',
]);

const LANG: Record<string, string> = {
  english: 'en',
  hindi: 'hi',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  arabic: 'ar',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  marathi: 'mr',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  punjabi: 'pa',
  urdu: 'ur',
  indonesian: 'id',
  russian: 'ru',
  chinese: 'zh',
  japanese: 'ja',
};

/** The ai_configuration object: the key may carry a trailing space at the source ("ai_configuration "); the exact key wins. */
export function aiConfigOf(cfg: Doc): Doc {
  const merged: Doc = {};
  for (const [k, v] of Object.entries(cfg))
    if (k.trim() === 'ai_configuration' && k !== 'ai_configuration') Object.assign(merged, obj(v));
  Object.assign(merged, obj(cfg.ai_configuration));
  return merged;
}

const slugify = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/@/g, ' at ')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const uniq = (base: string, taken: Set<string>): string => {
  let out = base;
  for (let i = 2; taken.has(out); i++) out = `${base}-${i}`;
  taken.add(out);
  return out;
};

export function buildWidgetPlan(a: {
  settings: FlowSettings;
  chatbotDocs: Map<string, Doc[]>;
  configs: Doc[];
  themes: Doc[];
  botOrder: string[];
  bots: Map<string, BotPlan>;
  fallbackAt: string;
  docs: Map<string, DocVerdict>;
  setDoc: (collection: string, d: Doc, v: DocVerdict) => void;
  tick: (k: string) => void;
}): { widgets: Map<string, WidgetPlan>; order: string[]; tally: Record<string, number> } {
  const widgets = new Map<string, WidgetPlan>();
  const order: string[] = [];
  const slugs = new Set<string>();
  const assistantSlugs = new Set<string>();
  const find = (list: Doc[], key: string | null): Doc | undefined =>
    key === null ? undefined : list.find((d) => str(d.id) === key || primaryKey(d) === key);
  const usedBy = new Map<string, string>(); // config / theme doc key -> first widget bot
  let loaded = 0;

  for (const botId of a.botOrder) {
    const bot = (a.chatbotDocs.get(botId) ?? [])[0];
    if (!bot) continue;
    if (isDeleted(bot) || bot.is_active === false) continue;
    const ch = (str(bot.channel) ?? 'whatsapp').toLowerCase();
    const web = /web|site|widget/.test(ch);
    const number = str(bot.whatsapp_number);
    const cfg = find(a.configs, str(bot.chatbot_configuration));
    const th = find(a.themes, str(bot.chatbot_theme));
    const cfgOk = cfg && !isDeleted(cfg) ? cfg : undefined;
    const thOk = th && !isDeleted(th) ? th : undefined;
    const wanted =
      web ||
      (!/whatsapp|^wa$/.test(ch)
        ? false
        : number !== null || (a.settings.widgetsForWhatsappBots && cfgOk !== undefined));
    if (!wanted) continue;
    const soft: Soft[] = [];
    const wp: WidgetPlan = {
      botId,
      verdict: { kind: 'load' },
      row: null,
      assistant: null,
      soft,
      configKey: cfgOk ? primaryKey(cfgOk) : null,
      themeKey: thOk ? primaryKey(thOk) : null,
    };
    widgets.set(botId, wp);
    order.push(botId);
    const c = cfgOk ?? {};
    const t = thOk ?? {};
    if (!cfgOk)
      soft.push({
        code: 'CONFIG_MISSING',
        reason:
          'the bot has no readable chatbot_configuration: the widget starts from the defaults',
      });
    if (!thOk)
      soft.push({
        code: 'THEME_MISSING',
        reason: 'the bot has no readable chatbot_theme: the widget keeps the default colours',
      });

    const ai = aiConfigOf(c);
    const aiEnabled = bool(ai.enabled);
    const waText = [
      c.whatsapp_prefilled_message_text,
      c.whatsapp_welcome_message_text,
      c.whatsapp_cta_button_text,
      c.whatsapp_subheader_text,
    ].some((x) => str(x) !== null);
    const mode = aiEnabled && (waText || number !== null) ? 'both' : aiEnabled ? 'ai' : 'whatsapp';
    const name = clipChars(str(bot.name) ?? `Waboo bot ${botId.slice(-6)}`, 120);
    const slug = uniq(slugify(name) || `widget-${sha256(botId).slice(0, 6)}`, slugs);

    // colours: only hex values are carried; anything else keeps the default and is counted
    let unusedColours = 0;
    const colour = (v: unknown): string | null => {
      if (v === null || v === undefined || v === '') return null;
      const h = hex(v);
      if (h === null) unusedColours++;
      return h;
    };
    const primary = colour(obj(t.primary).main);
    const btn = obj(t.button);
    const btnBg = colour(btn.background);
    const btnText = colour(btn.text);

    // placement
    const side = (v: unknown): 'bottom_right' | 'bottom_left' | null =>
      /left/i.test(s(v)) ? 'bottom_left' : /right/i.test(s(v)) ? 'bottom_right' : null;
    const position = side(c.desktop_display_position) ?? side(c.display_position) ?? 'bottom_right';
    const spacing = (v: unknown): number | null =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 500 ? v : null;
    const placement = (sd: unknown, sm: unknown, bm: unknown) => {
      const x = spacing(sm);
      const y = spacing(bm);
      const d = /left/i.test(s(sd)) ? 'left' : /right/i.test(s(sd)) ? 'right' : null;
      return d !== null && x !== null && y !== null
        ? { side: d, sideSpacing: x, bottomSpacing: y }
        : null;
    };
    const launcher: Record<string, unknown> = {};
    const intro = text(c.subheader_text ?? c.whatsapp_subheader_text, 500);
    if (intro) launcher.introMessage = intro;
    const dk = placement(
      c.desktop_display_position ?? c.display_position,
      c.desktop_side_margin,
      c.desktop_bottom_margin,
    );
    const mb = placement(
      c.mobile_display_position ?? c.display_position,
      c.mobile_side_margin,
      c.mobile_bottom_margin,
    );
    if (dk) launcher.desktop = dk;
    if (mb) launcher.mobile = mb;
    if (primary) launcher.colour = primary;

    // images are file references until the files step copies the objects; an absolute http(s) address is kept
    const refs: string[] = [];
    const logo = str(c.company_logo);
    const avatar = str(c.avatar);
    const bg = str(c.background_image);
    const logoUrl = url(logo);
    const avatarUrl = url(avatar);
    const bgUrl = url(bg);
    if (logo && !logoUrl) refs.push('company_logo');
    if (avatar && !avatarUrl) refs.push('avatar');
    if (bg && !bgUrl) refs.push('background_image');
    if (avatarUrl) launcher.avatar = avatarUrl;
    if (refs.length > 0)
      soft.push({
        code: 'FILE_REF_PENDING',
        reason:
          'these images are file references, not addresses: they come across with the files step',
        detail: refs,
      });

    // created / updated
    const created =
      wabooDate(bot.created_time) ??
      wabooDate(c.created_time) ??
      wabooDate(t.created_time) ??
      wabooDate(bot._id);
    let createdAt = created;
    if (!createdAt) {
      createdAt = new Date(a.fallbackAt);
      soft.push({ code: 'NO_DATE', reason: 'no usable date: stamped with the dump manifest time' });
    }
    let updatedAt = [
      wabooDate(bot.modified_time),
      wabooDate(c.modified_time),
      wabooDate(t.modified_time),
    ]
      .filter((x): x is Date => x !== null)
      .reduce<Date>((m, x) => (x > m ? x : m), createdAt);
    if (updatedAt < createdAt) updatedAt = createdAt;

    // whatsapp number: kept whole (digits), because the country code cannot be split safely
    let waNumber: string | null = null;
    if (number !== null) {
      const digits = number.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) {
        waNumber = digits;
        soft.push({
          code: 'WHATSAPP_NUMBER_NOT_SPLIT',
          reason:
            'the number is stored whole (digits with the country code) in target_whatsapp_number; target_whatsapp_cc is empty',
        });
      } else
        soft.push({
          code: 'WHATSAPP_NUMBER_UNREADABLE',
          reason: 'whatsapp_number has no readable digits: the widget has no target number',
        });
    }
    if (unusedColours > 0)
      soft.push({
        code: 'THEME_COLOUR_UNUSED',
        reason: 'theme colours that are not hex values are not carried (the default colour stays)',
        detail: unusedColours,
      });

    const welcome =
      mode === 'whatsapp'
        ? text(c.whatsapp_welcome_message_text ?? c.welcome_message_text, 2000)
        : text(c.welcome_message_text ?? c.whatsapp_welcome_message_text, 2000);
    const label = text(c.cta_button_text ?? c.whatsapp_cta_button_text, 80);
    wp.row = {
      assistant_id: null,
      name,
      slug,
      embed_token: '',
      mode,
      target_whatsapp_cc: null,
      target_whatsapp_number: waNumber,
      prefilled_message: text(c.whatsapp_prefilled_message_text ?? c.prefilled_message_text, 2000),
      position,
      button_color: primary ?? WIDGET_DEFAULTS.button_color,
      button_image_url: logoUrl,
      header_title: WIDGET_DEFAULTS.header_title,
      header_bg: primary ?? WIDGET_DEFAULTS.header_bg,
      header_text_color: WIDGET_DEFAULTS.header_text_color,
      welcome_message: welcome,
      message_bubble_color: WIDGET_DEFAULTS.message_bubble_color,
      message_text_color: WIDGET_DEFAULTS.message_text_color,
      body_bg_kind: bgUrl ? 'image' : WIDGET_DEFAULTS.body_bg_kind,
      body_bg_color: WIDGET_DEFAULTS.body_bg_color,
      body_bg_image_url: bgUrl,
      auto_open: bool(c.desktop_auto_triggering, false),
      button_label: label ?? WIDGET_DEFAULTS.button_label,
      action_button_bg: btnBg ?? primary ?? WIDGET_DEFAULTS.action_button_bg,
      action_button_text_color: btnText ?? WIDGET_DEFAULTS.action_button_text_color,
      collect_name: WIDGET_DEFAULTS.collect_name,
      collect_email: WIDGET_DEFAULTS.collect_email,
      collect_phone: WIDGET_DEFAULTS.collect_phone,
      // SAFETY: paused, and an allow-list that no site matches (an empty list answers every origin)
      status: 'paused',
      allowed_domains: [WIDGET_CLOSED_DOMAIN],
      launcher,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    };

    // the AI part: plain configuration only; the keys never enter a row
    if (aiEnabled) {
      const rawPrompt = str(ai.prompt) ?? str(c.prompt) ?? str(bot.prompt);
      let prompt: string | null = rawPrompt;
      if (prompt !== null) {
        const r = redactText(prompt);
        if (r.n > 0) {
          prompt = r.text;
          soft.push({
            code: 'PROMPT_REDACTED',
            reason:
              'the prompt held something that looks like a credential: it was replaced by [redacted]',
            detail: r.n,
          });
        }
      }
      const lang = (str(bot.primary_language) ?? 'english').toLowerCase();
      const code = LANG[lang] ?? (/^[a-z]{2}(-[a-z]+)?$/.test(lang) ? lang.slice(0, 2) : null);
      if (code === null)
        soft.push({
          code: 'LANGUAGE_GUESSED',
          reason: 'primary_language is not a language the tool knows: the assistant language is en',
          detail: lang,
        });
      const tRaw =
        typeof ai.temperature === 'number'
          ? ai.temperature
          : typeof c.temperature === 'number'
            ? c.temperature
            : NaN;
      const temp = Number.isFinite(tRaw)
        ? Math.min(2, Math.max(0, Math.round(tRaw * 100) / 100))
        : 0.7;
      wp.assistant = {
        name,
        slug: uniq(slugify(name) || `assistant-${sha256(botId).slice(0, 6)}`, assistantSlugs),
        system_prompt: prompt,
        language: code ?? 'en',
        ai_model: str(ai.model) ?? str(c.modelName) ?? 'gpt-4o-mini',
        temperature: temp.toFixed(2),
        // paused: nothing may call a model with this prompt until a person looks at it
        status: 'paused',
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      };
      soft.push({
        code: 'AI_KEYS_NOT_COPIED',
        reason:
          'API keys (the key NAMES are listed, never the values) are not copied; they go through the encrypted credential path',
        detail: Object.keys(ai)
          .filter((k) => /key/i.test(k))
          .sort(),
      });
    }
    const notPresent = Object.keys(c)
      .filter((k) => !MAPPED_CONFIG_KEYS.has(k.trim()) && c[k] !== null && c[k] !== undefined)
      .sort();
    const themeNotPresent = Object.keys(t)
      .filter((k) => !MAPPED_THEME_KEYS.has(k) && t[k] !== null && t[k] !== undefined)
      .sort();
    if (notPresent.length > 0 || themeNotPresent.length > 0)
      soft.push({
        code: 'CONFIG_NOT_PRESENT',
        reason: 'widget settings with no column (names only; the raw dump is the archive)',
        detail: { configuration: notPresent, theme: themeNotPresent },
      });
    soft.push({
      code: 'WABOO_STATE',
      reason: 'the state of the bot at the source (an imported widget is paused)',
      detail: {
        bot_enabled: bot.bot_enabled ?? null,
        chatbot_status: bot.chatbot_status ?? null,
        channel: bot.channel ?? null,
      },
    });
    if (cfgOk) usedBy.set(primaryKey(cfgOk), usedBy.get(primaryKey(cfgOk)) ?? botId);
    if (thOk) usedBy.set(primaryKey(thOk), usedBy.get(primaryKey(thOk)) ?? botId);

    if (a.settings.widgetLimit > 0 && loaded >= a.settings.widgetLimit) {
      wp.verdict = {
        kind: 'quarantine',
        code: 'PLAN_LIMIT',
        reason: `the plan allows ${a.settings.widgetLimit} chatbot widgets; this one would be number ${loaded + 1}`,
      };
      wp.row = null;
      wp.assistant = null;
      a.tick('widget quarantine PLAN_LIMIT');
      if (cfgOk && usedBy.get(primaryKey(cfgOk)) === botId) usedBy.delete(primaryKey(cfgOk));
      if (thOk && usedBy.get(primaryKey(thOk)) === botId) usedBy.delete(primaryKey(thOk));
      continue;
    }
    loaded++;
    a.tick('widget load');
    // the bot's own document: its home is the flow when it has one, else the widget
    const own = a.docs.get(docKey('chatbots', bot));
    if (!own || own.kind !== 'adopt')
      a.docs.set(docKey('chatbots', bot), { kind: 'adopt', table: 'chatbot_widgets', botId });
  }

  const tally: Record<string, number> = {};
  for (const [list, collection] of [
    [a.configs, 'chatbot_configuration'],
    [a.themes, 'chatbot_theme'],
  ] as const)
    for (const d of list) {
      const k = primaryKey(d);
      const bot = usedBy.get(k);
      if (bot !== undefined)
        a.setDoc(collection, d, { kind: 'adopt', table: 'chatbot_widgets', botId: bot });
      else
        a.setDoc(collection, d, {
          kind: 'exclude',
          code: isDeleted(d) ? 'SOFT_DELETED' : 'NO_WIDGET',
          reason: isDeleted(d)
            ? 'deleted at the source'
            : 'no widget bot refers to it (the bot is a WhatsApp bot without a widget, deleted, or not in the dump)',
        });
    }
  return { widgets, order, tally };
}
