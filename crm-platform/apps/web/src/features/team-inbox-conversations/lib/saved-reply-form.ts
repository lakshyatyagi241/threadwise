import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_TITLE_MAX,
  createSavedReplySchema,
  normalizeShortcut,
  renderSavedReply,
  sampleVariableLookup,
  updateSavedReplySchema,
  type CreateSavedReplyInput,
  type SavedReply,
  type SavedReplyScope,
  type UpdateSavedReplyInput,
} from '@crm/contracts';

/** What the form holds while it is open: text as typed, nothing normalised until it is saved. */
export interface SavedReplyDraft {
  shortcut: string;
  title: string;
  body: string;
  category: string;
  language: string;
  channelKinds: string[];
  scope: SavedReplyScope;
}

export const EMPTY_DRAFT: SavedReplyDraft = {
  shortcut: '',
  title: '',
  body: '',
  category: '',
  language: '',
  channelKinds: [],
  scope: 'shared',
};

export const draftOf = (r: SavedReply): SavedReplyDraft => ({
  shortcut: r.shortcut,
  title: r.title,
  body: r.body,
  category: r.category ?? '',
  language: r.language ?? '',
  channelKinds: [...r.channelKinds],
  scope: r.scope,
});

export type DraftProblem =
  'shortcutEmpty' | 'titleEmpty' | 'titleLong' | 'bodyEmpty' | 'bodyLong' | 'languageFormat';

/** Problems the person can fix before saving; the server checks the same rules again. Keyed by the field they belong to. */
export function draftProblems(
  d: SavedReplyDraft,
): Partial<Record<keyof SavedReplyDraft, DraftProblem>> {
  const out: Partial<Record<keyof SavedReplyDraft, DraftProblem>> = {};
  if (normalizeShortcut(d.shortcut) === '') out.shortcut = 'shortcutEmpty';
  if (d.title.trim() === '') out.title = 'titleEmpty';
  else if (d.title.trim().length > SAVED_REPLY_TITLE_MAX) out.title = 'titleLong';
  if (d.body.trim() === '') out.body = 'bodyEmpty';
  else if (d.body.trim().length > SAVED_REPLY_BODY_MAX) out.body = 'bodyLong';
  if (
    d.language.trim() !== '' &&
    !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(d.language.trim())
  ) {
    out.language = 'languageFormat';
  }
  return out;
}

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** The create body for a valid draft (throws a ZodError if it is not: check `draftProblems` first). */
export const toCreateInput = (d: SavedReplyDraft): CreateSavedReplyInput =>
  createSavedReplySchema.parse({
    shortcut: d.shortcut,
    title: d.title,
    body: d.body,
    category: orNull(d.category),
    language: orNull(d.language),
    channelKinds: d.channelKinds,
    scope: d.scope,
  });

export const toUpdateInput = (d: SavedReplyDraft, rowVersion: number): UpdateSavedReplyInput =>
  updateSavedReplySchema.parse({
    rowVersion,
    shortcut: d.shortcut,
    title: d.title,
    body: d.body,
    category: orNull(d.category),
    language: orNull(d.language),
    channelKinds: d.channelKinds,
  });

/** The reply as the preview shows it: sample customer data in the catalogue's variables, anything else left as written. */
export const previewOf = (body: string) => renderSavedReply(body, sampleVariableLookup);

/** Inserts `text` at the textarea's selection and returns the new value and caret. */
export function insertAtSelection(
  value: string,
  selection: { start: number; end: number },
  text: string,
): { value: string; caret: number } {
  return {
    value: value.slice(0, selection.start) + text + value.slice(selection.end),
    caret: selection.start + text.length,
  };
}
