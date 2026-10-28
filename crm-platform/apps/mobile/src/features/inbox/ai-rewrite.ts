import type { AiModelOption, InboxRewriteAction } from '@crm/contracts';

/** The vendors the rewrite route can call; a model of any other vendor (it is listed for other editors) cannot be asked. */
const REWRITE_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;
export type RewriteProvider = (typeof REWRITE_PROVIDERS)[number];

export interface AiModelChoice {
  provider: RewriteProvider;
  value: string;
}

/** The model the assistant asks: the first one of a vendor the rewrite route can call (null: none is enabled, so there is no button). */
export function pickAiModel(models: readonly AiModelOption[] | undefined): AiModelChoice | null {
  for (const m of models ?? []) {
    const provider = REWRITE_PROVIDERS.find((p) => p === m.provider);
    if (provider) return { provider, value: m.value };
  }
  return null;
}

export const REWRITE_ACTIONS: readonly InboxRewriteAction[] = [
  'condense',
  'fix',
  'positive',
  'translate',
];

/**
 * The languages the assistant can translate to, the same list as the web inbox. The name is the English one: it is what the AI is told
 * (`language` in the request) and what is shown, so the list does not depend on the phone's `Intl.DisplayNames`.
 */
export const TRANSLATE_LANGUAGES: readonly string[] = [
  'Afrikaans',
  'Albanian',
  'Arabic',
  'Armenian',
  'Azerbaijani',
  'Bengali',
  'Bulgarian',
  'Catalan',
  'Chinese',
  'Croatian',
  'Czech',
  'Danish',
  'Dutch',
  'English',
  'Estonian',
  'Filipino',
  'Finnish',
  'French',
  'German',
  'Greek',
  'Gujarati',
  'Hebrew',
  'Hindi',
  'Hungarian',
  'Indonesian',
  'Italian',
  'Japanese',
  'Kannada',
  'Kazakh',
  'Korean',
  'Latvian',
  'Lithuanian',
  'Malay',
  'Malayalam',
  'Marathi',
  'Nepali',
  'Norwegian',
  'Persian',
  'Polish',
  'Portuguese',
  'Punjabi',
  'Romanian',
  'Russian',
  'Serbian',
  'Slovak',
  'Slovenian',
  'Spanish',
  'Swahili',
  'Swedish',
  'Tamil',
  'Telugu',
  'Thai',
  'Turkish',
  'Ukrainian',
  'Urdu',
  'Uzbek',
  'Vietnamese',
  'Welsh',
  'Zulu',
];

/** The languages whose name contains what was typed (any case); everything when nothing is typed. */
export const filterLanguages = (query: string): readonly string[] => {
  const needle = query.trim().toLowerCase();
  return needle === ''
    ? TRANSLATE_LANGUAGES
    : TRANSLATE_LANGUAGES.filter((l) => l.toLowerCase().includes(needle));
};
