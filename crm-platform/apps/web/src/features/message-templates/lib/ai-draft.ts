import { tplAiDraftSchema, type TplAiDraft, type TplMetaCategory } from '@crm/contracts';
import { BUTTON_TEXT_MAX, EDITOR_BUTTON_MAX, canAdd, newRow, type ButtonRow } from './buttons';
import {
  BODY_MAX,
  FOOTER_MAX,
  HEADER_MAX,
  tidyName,
  withBody,
  withHeaderKind,
  withHeaderText,
  type FormState,
} from './form-model';
import { TEMPLATE_LANGUAGES } from './languages';

/**
 * "Build with AI" (TW-TPL-016): the brief's choices. Each id is a key under `message-templates.ai.<list>` (the label shown, and the
 * words the model gets, in the viewer's language). Reference's lists, in its order.
 */
export const AI_INDUSTRIES = [
  'retail',
  'food',
  'healthcare',
  'education',
  'travel',
  'finance',
  'realEstate',
  'beauty',
  'logistics',
  'services',
  'nonprofit',
  'other',
] as const;
export const AI_OCCASIONS = [
  'launch',
  'sale',
  'orderConfirmation',
  'shipping',
  'appointment',
  'welcome',
  'feedback',
  'abandonedCart',
  'reengage',
  'event',
  'festival',
  'other',
] as const;
export const AI_PURPOSES = [
  'inform',
  'promote',
  'confirm',
  'remind',
  'collectFeedback',
  'reengage',
  'purchase',
  'booking',
] as const;
export const AI_ACTIONS = ['website', 'call', 'book', 'order', 'catalog', 'code', 'other'] as const;
export const AI_TONES = [
  'friendly',
  'professional',
  'concise',
  'empathetic',
  'excited',
  'formal',
] as const;

/** Only the two categories the model writes for; an Authentication template is a fixed text with no copy to draft. */
export const AI_CATEGORIES: readonly TplMetaCategory[] = ['MARKETING', 'UTILITY'];
export const canDraftCategory = (c: TplMetaCategory): c is 'MARKETING' | 'UTILITY' =>
  c === 'MARKETING' || c === 'UTILITY';

/** The vendors the template writer can call (the same three Reference offered). */
export const isAiProvider = (v: string): v is 'openai' | 'anthropic' | 'gemini' =>
  v === 'openai' || v === 'anthropic' || v === 'gemini';

/** Buttons the draft asks for, as editor rows: at most three, within Meta's per-kind limits, text cut to 25, empty ones dropped. */
export function rowsFromDraft(buttons: TplAiDraft['buttons']): ButtonRow[] {
  const rows: ButtonRow[] = [];
  for (const b of buttons) {
    if (rows.length >= EDITOR_BUTTON_MAX) break;
    const text = b.text.trim().slice(0, BUTTON_TEXT_MAX);
    if (text === '') continue;
    const kind = b.type === 'QUICK_REPLY' ? 'quick_reply' : b.type === 'URL' ? 'url' : 'phone';
    if (!canAdd(rows, kind, EDITOR_BUTTON_MAX)) continue;
    const row = newRow(kind);
    row.text = text;
    if (b.type === 'URL') row.url = b.url.trim();
    if (b.type === 'PHONE_NUMBER') row.phone = b.phoneNumber.trim();
    rows.push(row);
  }
  return rows;
}

/**
 * Pastes a draft into the form: the name (a slug, 60 characters), a text header (cut to 60; a draft without one clears a text header
 * and leaves a media or location header alone), the body (1,024), the footer (60) and the buttons. The number, category and language
 * are the form's own and stay. Nothing is submitted.
 */
export function applyAiDraft(s: FormState, draft: TplAiDraft): FormState {
  let next = s;
  const header = (draft.header ?? '').trim();
  if (header !== '') {
    next = withHeaderText(withHeaderKind(next, 'text'), header.slice(0, HEADER_MAX));
  } else if (next.headerKind === 'text') {
    next = withHeaderKind(next, 'none');
  }
  next = withBody(next, draft.body.slice(0, BODY_MAX));
  return {
    ...next,
    name: tidyName(draft.name),
    footer: (draft.footer ?? '').trim().slice(0, FOOTER_MAX),
    buttons: rowsFromDraft(draft.buttons),
  };
}

/**
 * The hand-off from the guided campaign wizard to the new-template form: the wizard has no template editor, so it keeps the draft in
 * the tab's session storage under this key and opens `/templates/new`; the form reads it once on mount and deletes it. Session
 * storage is the tab's own, so it never reaches another tab or another person, and it is gone when the tab closes.
 */
export const AI_DRAFT_STORAGE_KEY = 'threadwise.templates.aiDraft';
/** A draft older than this is ignored (somebody wandered off after the redirect failed). */
export const AI_DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

export interface StashedAiDraft {
  draft: TplAiDraft;
  language: string;
  metaCategory: 'MARKETING' | 'UTILITY';
}

export function stashAiDraft(v: StashedAiDraft, now = Date.now()): void {
  try {
    window.sessionStorage.setItem(AI_DRAFT_STORAGE_KEY, JSON.stringify({ ...v, at: now }));
  } catch {
    /* storage can be blocked; the person then starts from an empty form */
  }
}

/** Reads the stashed draft and removes it in the same call, so a reload or a second visit starts empty. */
export function takeAiDraft(now = Date.now()): StashedAiDraft | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY);
    window.sessionStorage.removeItem(AI_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const draft = tplAiDraftSchema.safeParse(v.draft);
    if (!draft.success) return null;
    if (typeof v.at !== 'number' || now - v.at > AI_DRAFT_MAX_AGE_MS || now < v.at) return null;
    const language =
      typeof v.language === 'string' && TEMPLATE_LANGUAGES.includes(v.language)
        ? v.language
        : 'en_US';
    const metaCategory = v.metaCategory === 'UTILITY' ? 'UTILITY' : 'MARKETING';
    return { draft: draft.data, language, metaCategory };
  } catch {
    return null;
  }
}
