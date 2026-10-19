import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_TITLE_MAX,
  createSavedReplySchema,
  normalizeShortcut,
  renderSavedReply,
  sampleVariableLookup,
  updateSavedReplySchema,
  type ChannelKind,
  type CreateSavedReplyInput,
  type SavedReply,
  type SavedReplyScope,
  type UpdateSavedReplyInput,
} from '@crm/contracts';

/** What the form holds while it is open: text as typed, nothing normalised until it is saved (the web form's own draft). */
export interface QuickReplyDraft {
  shortcut: string;
  title: string;
  body: string;
  category: string;
  language: string;
  channelKinds: ChannelKind[];
  scope: SavedReplyScope;
}

export const EMPTY_DRAFT: QuickReplyDraft = {
  shortcut: '',
  title: '',
  body: '',
  category: '',
  language: '',
  channelKinds: [],
  scope: 'shared',
};

export const draftOf = (reply: SavedReply): QuickReplyDraft => ({
  shortcut: reply.shortcut,
  title: reply.title,
  body: reply.body,
  category: reply.category ?? '',
  language: reply.language ?? '',
  channelKinds: [...reply.channelKinds],
  scope: reply.scope,
});

export type DraftField = 'shortcut' | 'title' | 'body' | 'language';
export type DraftProblem =
  'shortcutEmpty' | 'titleEmpty' | 'titleLong' | 'bodyEmpty' | 'bodyLong' | 'languageFormat';

/** The shape a language code must have (the contract's own pattern, for a message before the request). */
const LANGUAGE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

/** Problems the person can fix before saving, keyed by the field they belong to; the server checks the same rules again. */
export function draftProblems(draft: QuickReplyDraft): Partial<Record<DraftField, DraftProblem>> {
  const out: Partial<Record<DraftField, DraftProblem>> = {};
  if (normalizeShortcut(draft.shortcut) === '') out.shortcut = 'shortcutEmpty';
  if (draft.title.trim() === '') out.title = 'titleEmpty';
  else if (draft.title.trim().length > SAVED_REPLY_TITLE_MAX) out.title = 'titleLong';
  if (draft.body.trim() === '') out.body = 'bodyEmpty';
  else if (draft.body.trim().length > SAVED_REPLY_BODY_MAX) out.body = 'bodyLong';
  if (draft.language.trim() !== '' && !LANGUAGE.test(draft.language.trim())) {
    out.language = 'languageFormat';
  }
  return out;
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The create body for a valid draft (throws a ZodError if it is not: check `draftProblems` first). */
export const toCreateInput = (draft: QuickReplyDraft): CreateSavedReplyInput =>
  createSavedReplySchema.parse({
    shortcut: draft.shortcut,
    title: draft.title,
    body: draft.body,
    category: orNull(draft.category),
    language: orNull(draft.language),
    channelKinds: draft.channelKinds,
    scope: draft.scope,
  });

/** The update body: the version that was read, and every field (a reply cannot change scope after it is saved). */
export const toUpdateInput = (draft: QuickReplyDraft, rowVersion: number): UpdateSavedReplyInput =>
  updateSavedReplySchema.parse({
    rowVersion,
    shortcut: draft.shortcut,
    title: draft.title,
    body: draft.body,
    category: orNull(draft.category),
    language: orNull(draft.language),
    channelKinds: draft.channelKinds,
  });

/** The reply as the preview shows it: sample customer data in the catalogue's variables, anything else left as written. */
export const previewOf = (body: string) => renderSavedReply(body, sampleVariableLookup);

/** Puts `text` where the cursor is (replacing a selection) and says where the cursor goes next. */
export function insertAtSelection(
  value: string,
  selection: { start: number; end: number },
  text: string,
): { value: string; caret: number } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}

/** "Close to the limit" begins at this share of it (the web's own threshold). */
const NEAR_LIMIT = 0.8;

/** Where the library stands against the plan's limit; shared and personal replies both count. */
export function limitState(
  total: number,
  limit: number | null,
): 'none' | 'ok' | 'near' | 'reached' {
  if (limit === null) return 'none';
  if (total >= limit) return 'reached';
  return total >= limit * NEAR_LIMIT ? 'near' : 'ok';
}
