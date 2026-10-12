import {
  FAQ_LIMITS,
  FLB_NODE_TYPES,
  createFaqEntrySchema,
  updateFaqEntrySchema,
  type CreateFaqEntryInput,
  type FaqAnswerType,
  type FaqEntry,
  type FaqFlowNode,
  type FaqStatus,
  type UpdateFaqEntryInput,
} from '@crm/contracts';

/** What the editor form holds. Text and flow answers are both kept so switching tabs back and forth loses nothing. */
export interface FaqDraft {
  question: string;
  answerType: FaqAnswerType;
  answerText: string;
  flowId: string | null;
  /** Only for display of a picked flow that is not in the picker's loaded page. */
  flowName: string | null;
  /** The step the flow starts at; null means the flow's own start. Kept only with a flow answer. */
  flowNodeId: string | null;
  category: string;
  status: FaqStatus;
  /** Null: follow the workspace sensitivity. */
  thresholdOverride: number | null;
}

export type DraftField =
  'question' | 'answerText' | 'flowId' | 'flowNodeId' | 'category' | 'thresholdOverride';
export type FieldProblem = 'required' | 'tooLong' | 'invalid';
export type DraftProblems = Partial<Record<DraftField, FieldProblem>>;

export const emptyDraft = (prefill?: { question?: string }): FaqDraft => ({
  question: prefill?.question ?? '',
  answerType: 'text',
  answerText: '',
  flowId: null,
  flowName: null,
  flowNodeId: null,
  category: '',
  status: 'active',
  thresholdOverride: null,
});

export const draftFromEntry = (e: FaqEntry): FaqDraft => ({
  question: e.question,
  answerType: e.answerType,
  answerText: e.answerText ?? '',
  flowId: e.flowId,
  flowName: e.flowName,
  flowNodeId: e.flowNodeId,
  category: e.category ?? '',
  status: e.status,
  thresholdOverride: e.thresholdOverride,
});

export function isDirty(a: FaqDraft, b: FaqDraft): boolean {
  return (
    a.question !== b.question ||
    a.answerType !== b.answerType ||
    a.answerText !== b.answerText ||
    a.flowId !== b.flowId ||
    a.flowNodeId !== b.flowNodeId ||
    a.category !== b.category ||
    a.status !== b.status ||
    a.thresholdOverride !== b.thresholdOverride
  );
}

/** The answer fields the API expects: the one that is not in use is sent as null so it cannot linger. */
function answerFields(d: FaqDraft) {
  return {
    answerType: d.answerType,
    answerText: d.answerType === 'text' ? d.answerText : null,
    flowId: d.answerType === 'flow' ? d.flowId : null,
    // A step belongs to a flow answer only; without a flow chosen there is nothing to start at.
    flowNodeId: d.answerType === 'flow' && d.flowId ? d.flowNodeId : null,
  };
}

const common = (d: FaqDraft) => ({
  question: d.question,
  ...answerFields(d),
  category: d.category,
  status: d.status,
  thresholdOverride: d.thresholdOverride,
});

const FIELDS: readonly DraftField[] = [
  'question',
  'answerText',
  'flowId',
  'flowNodeId',
  'category',
  'thresholdOverride',
];

/** Local rules are the contract's own schema; its English text is dropped and the issue is mapped to a message key. */
export function validateDraft(d: FaqDraft): DraftProblems {
  const parsed = createFaqEntrySchema.safeParse({ ...common(d), variations: [] });
  if (parsed.success) return {};
  const out: DraftProblems = {};
  for (const issue of parsed.error.issues) {
    const field = FIELDS.find((f) => f === issue.path[0]);
    if (!field || out[field]) continue;
    out[field] =
      field === 'thresholdOverride'
        ? 'invalid'
        : issue.code === 'too_big'
          ? 'tooLong'
          : issue.code === 'too_small' || issue.code === 'custom'
            ? 'required'
            : 'invalid';
  }
  // A flow answer reports its missing flow on `answerText` in the contract; show it on the picker.
  if (d.answerType === 'flow' && out.answerText) {
    delete out.answerText;
    out.flowId = 'required';
  }
  return out;
}

export function toCreateInput(
  d: FaqDraft,
  variations: string[],
  resolveLogId?: string,
): CreateFaqEntryInput {
  return createFaqEntrySchema.parse({
    ...common(d),
    variations,
    ...(resolveLogId ? { resolveLogId } : {}),
  });
}

export function toUpdateInput(d: FaqDraft, rowVersion: number): UpdateFaqEntryInput {
  return updateFaqEntrySchema.parse({ ...common(d), rowVersion });
}

/** Server field paths the form shows inline. `variations.N` etc. are not form fields and are returned separately. */
export function mapServerProblems(errors: Array<{ path: string; message: string }>): {
  fields: Partial<Record<DraftField, string>>;
  other: string[];
} {
  const fields: Partial<Record<DraftField, string>> = {};
  const other: string[] = [];
  for (const e of errors) {
    const field = FIELDS.find((f) => e.path === f);
    if (field) fields[field] ??= e.message;
    else other.push(e.message);
  }
  return { fields, other };
}

// --- the step a flow answer starts at ---------------------------------------------------------------------------------------

/** The flow editor's start node: picking it means "no step", the flow's own start. */
const START_TYPE = 'trigger';

export interface StepOption {
  /** Empty string is the flow's start (sent as no step). */
  value: string;
  label: string;
  start: boolean;
}

/** The name of a node type as the flow editor shows it; an unknown type is shown as it is. */
export const stepTypeName = (type: string): string => FLB_NODE_TYPES[type]?.label ?? type;

/** The name a saved step carries in an FAQ (the API falls back to the raw type id when the author left it blank). */
export const stepDisplayName = (label: string): string => FLB_NODE_TYPES[label]?.label ?? label;

const idHint = (id: string): string => `#${id.length > 8 ? id.slice(0, 6) : id}`;

/** `<type name> · <what the author called it, or a short id>`. */
export function stepOptionLabel(n: Pick<FaqFlowNode, 'id' | 'type' | 'label'>): string {
  const name = n.label.trim();
  return `${stepTypeName(n.type)} · ${name === '' ? idHint(n.id) : name}`;
}

/**
 * The picker's choices after the flow's start (that one is the caller's, because its text is translated). The trigger is the start
 * itself, so it is not listed twice.
 */
export function stepOptions(nodes: readonly FaqFlowNode[]): StepOption[] {
  return nodes
    .filter((n) => n.type !== START_TYPE)
    .map((n) => ({ value: n.id, label: stepOptionLabel(n), start: false }));
}

/** What the select shows for the saved step: the trigger's id counts as the start, since that is where it starts anyway. */
export function stepSelectValue(
  flowNodeId: string | null,
  nodes: readonly FaqFlowNode[] | undefined,
): string {
  if (!flowNodeId) return '';
  return nodes?.some((n) => n.id === flowNodeId && n.type === START_TYPE) ? '' : flowNodeId;
}

/**
 * The chosen step is gone from the flow. From the saved entry that is `flowNodeLabel === null` with an id set (the same test the list
 * uses); in the editor it is also true once the flow's steps are loaded and the id is not among them.
 */
export function stepIsMissing(
  draft: Pick<FaqDraft, 'answerType' | 'flowId' | 'flowNodeId'>,
  saved: Pick<FaqEntry, 'flowId' | 'flowNodeId' | 'flowNodeLabel'> | null,
  nodes: readonly FaqFlowNode[] | undefined,
): boolean {
  if (draft.answerType !== 'flow' || !draft.flowId || !draft.flowNodeId) return false;
  if (nodes) return !nodes.some((n) => n.id === draft.flowNodeId);
  return (
    saved !== null &&
    saved.flowId === draft.flowId &&
    saved.flowNodeId === draft.flowNodeId &&
    saved.flowNodeLabel === null
  );
}

// --- variations ---------------------------------------------------------------------------------------------------------

/** The server compares ignoring case and spacing; so does the preview. */
export const variationKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

const LIST_MARK = /^\s*(?:[-*•]|\d+[.)])\s+/;

export interface VariationBatch {
  /** New, unique phrasings in the order typed. */
  fresh: string[];
  /** Lines that repeat another line or something the FAQ already has. */
  duplicates: string[];
  /** Lines over the length limit (left out). */
  tooLong: string[];
  /** Fresh lines that do not fit under the FAQ's variation cap (left out of `fresh`). */
  overflow: string[];
}

/** One phrasing per line, bullets and numbering ignored; blank lines dropped; checked against what the FAQ already holds. */
export function parseVariationLines(
  raw: string,
  existing: readonly string[],
  room: number,
): VariationBatch {
  const seen = new Set(existing.map(variationKey));
  const out: VariationBatch = { fresh: [], duplicates: [], tooLong: [], overflow: [] };
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(LIST_MARK, '').trim().replace(/\s+/g, ' ');
    if (text === '') continue;
    if (text.length > FAQ_LIMITS.variation) {
      out.tooLong.push(text);
      continue;
    }
    const key = variationKey(text);
    if (seen.has(key)) {
      out.duplicates.push(text);
      continue;
    }
    seen.add(key);
    if (out.fresh.length >= Math.max(0, room)) out.overflow.push(text);
    else out.fresh.push(text);
  }
  return out;
}

/** The API takes at most `variationsPerRequest` texts at once. */
export function chunkTexts(
  texts: readonly string[],
  size = FAQ_LIMITS.variationsPerRequest,
): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < texts.length; i += size) out.push(texts.slice(i, i + size));
  return out;
}

export const variationRoom = (count: number, max: number): number => Math.max(0, max - count);
