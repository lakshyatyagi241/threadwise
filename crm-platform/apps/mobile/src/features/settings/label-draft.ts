import {
  INBOX_TAG_COLOR_PATTERN,
  createInboxTagSchema,
  updateInboxTagSchema,
  type CreateInboxTagInput,
  type InboxTag,
  type UpdateInboxTagInput,
} from '@crm/contracts';
import { DEFAULT_LABEL_COLOR } from '@/lib/theme/tokens';

/** What the label form holds while it is open: text as typed. */
export interface LabelDraft {
  name: string;
  color: string;
  description: string;
}

export const EMPTY_LABEL: LabelDraft = { name: '', color: DEFAULT_LABEL_COLOR, description: '' };

export const draftOfLabel = (label: InboxTag): LabelDraft => ({
  name: label.name,
  color: label.color ?? DEFAULT_LABEL_COLOR,
  description: label.description ?? '',
});

export type LabelField = 'name' | 'color';
export type LabelProblem = 'nameEmpty' | 'colorInvalid';

/** Problems the person can fix before saving, by field; the server checks the same rules again. */
export function labelProblems(draft: LabelDraft): Partial<Record<LabelField, LabelProblem>> {
  const out: Partial<Record<LabelField, LabelProblem>> = {};
  // The name box stops typing at the longest name the server takes, so only an empty one is left to find.
  if (draft.name.trim() === '') out.name = 'nameEmpty';
  if (!INBOX_TAG_COLOR_PATTERN.test(draft.color.trim())) out.color = 'colorInvalid';
  return out;
}

export const toCreateLabel = (draft: LabelDraft): CreateInboxTagInput =>
  createInboxTagSchema.parse({
    name: draft.name,
    color: draft.color,
    ...(draft.description.trim() ? { description: draft.description } : {}),
  });

/** An empty description clears it (`null`); the version is the one that was read. */
export const toUpdateLabel = (draft: LabelDraft, rowVersion: number): UpdateInboxTagInput =>
  updateInboxTagSchema.parse({
    rowVersion,
    name: draft.name,
    color: draft.color,
    description: draft.description.trim() === '' ? null : draft.description,
  });
