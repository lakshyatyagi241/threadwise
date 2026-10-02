import type { PlatformAiKeyItem, UpdatePlatformAiKeyInput } from '@crm/contracts';

/** What the admin has typed into one provider card. Everything is text, as the inputs hold it. */
export interface CardDraft {
  apiKey: string;
  defaultModel: string;
  sortOrder: string;
  maxTokens: string;
  extraModels: string;
}

export const draftFromItem = (item: PlatformAiKeyItem): CardDraft => ({
  apiKey: '',
  defaultModel: item.defaultModel ?? '',
  sortOrder: String(item.sortOrder),
  maxTokens: item.maxTokens === null ? '' : String(item.maxTokens),
  extraModels: item.extraModels.join(', '),
});

/** "a, b ,, c" as ["a", "b", "c"], dropping blanks and repeats. */
export function parseModelList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter((m) => m !== ''),
    ),
  ];
}

export type DraftError = 'maxTokens' | 'sortOrder' | 'defaultModel' | 'extraModels';

const wholeNumber = (s: string) => /^\d+$/.test(s.trim());

/**
 * The request body for a save: the row version plus only what changed. A blank key field is left out (the server keeps
 * the saved key). A cleared ceiling is sent as null; a ceiling on a vendor without the field is never sent.
 * Returns the first invalid field instead when something cannot be sent.
 */
export function toUpdateBody(
  item: PlatformAiKeyItem,
  draft: CardDraft,
): { body: UpdatePlatformAiKeyInput } | { error: DraftError } {
  const body: UpdatePlatformAiKeyInput = { rowVersion: item.rowVersion };
  if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();

  const model = draft.defaultModel.trim();
  if (model.length > 80) return { error: 'defaultModel' };
  if (model !== (item.defaultModel ?? '') && model !== '') body.defaultModel = model;

  if (draft.sortOrder.trim() !== String(item.sortOrder)) {
    if (!wholeNumber(draft.sortOrder) || Number(draft.sortOrder) > 32767)
      return { error: 'sortOrder' };
    body.sortOrder = Number(draft.sortOrder);
  }

  if (
    item.supportsMaxTokens &&
    draft.maxTokens.trim() !== (item.maxTokens === null ? '' : String(item.maxTokens))
  ) {
    if (draft.maxTokens.trim() === '') body.maxTokens = null;
    else if (
      !wholeNumber(draft.maxTokens) ||
      Number(draft.maxTokens) < 1 ||
      Number(draft.maxTokens) > 10_000_000
    )
      return { error: 'maxTokens' };
    else body.maxTokens = Number(draft.maxTokens);
  }

  const models = parseModelList(draft.extraModels);
  if (models.some((m) => m.length > 80) || models.length > 40) return { error: 'extraModels' };
  if (JSON.stringify(models) !== JSON.stringify(item.extraModels)) body.extraModels = models;

  return { body };
}

/** Whether saving would change anything (the save button stays disabled otherwise). */
export function isDirty(item: PlatformAiKeyItem, draft: CardDraft): boolean {
  const result = toUpdateBody(item, draft);
  if ('error' in result) return true;
  return Object.keys(result.body).length > 1;
}
