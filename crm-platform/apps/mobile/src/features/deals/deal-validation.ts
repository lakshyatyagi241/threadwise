import {
  DEAL_TITLE_MAX,
  createDealSchema,
  updateDealSchema,
  type CreateDealInput,
  type DealResponse,
  type UpdateDealInput,
} from '@crm/contracts';
import { parseDateText } from '@/lib/format/dates';
import { amountFromInput } from './money';

/** Who owns the deal: the caller (the API's default when nothing is sent), nobody, or a named member of the team. */
export type OwnerChoice =
  { kind: 'me' } | { kind: 'none' } | { kind: 'user'; id: string; name: string };

export interface ContactChoice {
  id: string;
  name: string;
}

export interface DealFormValues {
  title: string;
  /** The amount as typed ("1,250.50"); blank is none. */
  value: string;
  currency: string;
  /** The stage a NEW deal starts in; an edit cannot change it here (the stage moves through its own routes). */
  stageId: string;
  owner: OwnerChoice;
  contact: ContactChoice | null;
  /** The expected close day as typed, "2026-10-31"; blank for none. */
  close: string;
}

/** The fields a message can sit under. */
export type DealFormField = 'title' | 'value' | 'close';

export type DealFormErrorKey =
  | 'deals.form.errors.titleRequired'
  | 'deals.form.errors.titleTooLong'
  | 'deals.form.errors.valueInvalid'
  | 'deals.form.errors.closeInvalid';

export type DealFormProblems = Partial<Record<DealFormField, DealFormErrorKey>>;

/** A form that starts empty: in the pipeline's currency, owned by the person adding it. */
export const emptyDeal = (currency: string, stageId: string): DealFormValues => ({
  title: '',
  value: '',
  currency,
  stageId,
  owner: { kind: 'me' },
  contact: null,
  close: '',
});

/** The rules of the form, checked before anything is sent. What only the server can know (is this member active, is this stage of this pipeline) comes back as its answer. */
export function validateDeal(values: DealFormValues): DealFormProblems {
  const problems: DealFormProblems = {};
  const title = values.title.trim();
  if (!title) problems.title = 'deals.form.errors.titleRequired';
  else if (title.length > DEAL_TITLE_MAX) problems.title = 'deals.form.errors.titleTooLong';
  if (amountFromInput(values.value, values.currency) === null)
    problems.value = 'deals.form.errors.valueInvalid';
  const close = values.close.trim();
  if (close && !parseDateText(close)) problems.close = 'deals.form.errors.closeInvalid';
  return problems;
}

const ownerBody = (choice: OwnerChoice): { ownerId?: string | null } => {
  if (choice.kind === 'none') return { ownerId: null };
  return choice.kind === 'user' ? { ownerId: choice.id } : {};
};

/** What the create form sends. Leaving the owner out is how the API is told "the caller", and the pipeline and stage name the column. */
export function buildCreateBody(
  values: DealFormValues,
  pipelineId: string | undefined,
): CreateDealInput {
  const value = amountFromInput(values.value, values.currency);
  const close = parseDateText(values.close);
  return {
    title: values.title.trim(),
    ...(pipelineId ? { pipelineId } : {}),
    ...(values.stageId ? { stageId: values.stageId } : {}),
    ...(values.value.trim() !== '' && value !== null ? { value } : {}),
    currency: values.currency,
    ...ownerBody(values.owner),
    ...(values.contact ? { contactId: values.contact.id } : {}),
    ...(close ? { expectedCloseDate: close } : {}),
  };
}

/** What the form starts from when it edits a deal: the deal as the API has it. */
export function valuesOfDeal(deal: DealResponse, myId: string | undefined): DealFormValues {
  let owner: OwnerChoice = { kind: 'none' };
  if (deal.owner) {
    owner =
      deal.owner.id === myId
        ? { kind: 'me' }
        : { kind: 'user', id: deal.owner.id, name: deal.owner.name };
  }
  return {
    title: deal.title,
    value: deal.value,
    currency: deal.currency,
    stageId: deal.stage.id,
    owner,
    contact: deal.contact ? { id: deal.contact.id, name: deal.contact.name ?? '' } : null,
    close: deal.expectedCloseDate ?? '',
  };
}

/**
 * The fields the form changed, as the API's update body: an emptied field is sent as null, an untouched one is left out. A new
 * currency travels with the amount (the API refuses one without the other; the amount is relabelled, never converted).
 */
export function buildUpdateBody(
  deal: DealResponse,
  values: DealFormValues,
  myId: string | undefined,
): Omit<UpdateDealInput, 'rowVersion'> {
  const body: Omit<UpdateDealInput, 'rowVersion'> = {};
  const title = values.title.trim();
  if (title !== deal.title) body.title = title;

  const value = amountFromInput(values.value, values.currency);
  const before = amountFromInput(deal.value, deal.currency);
  const currencyChanged = values.currency !== deal.currency;
  if (value !== null && (currencyChanged || value !== before)) body.value = value;
  if (currencyChanged) body.currency = values.currency;

  const ownerBefore = deal.owner?.id ?? null;
  const ownerAfter =
    values.owner.kind === 'none'
      ? null
      : values.owner.kind === 'me'
        ? (myId ?? ownerBefore)
        : values.owner.id;
  if (ownerAfter !== ownerBefore) body.ownerId = ownerAfter;

  const contactAfter = values.contact?.id ?? null;
  if (contactAfter !== (deal.contact?.id ?? null)) body.contactId = contactAfter;

  const close = parseDateText(values.close);
  if ((close ?? null) !== (deal.expectedCloseDate ?? null)) body.expectedCloseDate = close;
  return body;
}

/**
 * The contract's own schema as the last gate: whatever the rules above let through must be a body the API accepts. A refusal
 * here means the form and the contract have drifted apart, and is shown under the field the contract names.
 */
export function contractProblems(
  body: CreateDealInput | UpdateDealInput,
  mode: 'create' | 'update',
): DealFormProblems {
  const result = (mode === 'create' ? createDealSchema : updateDealSchema).safeParse(body);
  if (result.success) return {};
  const problems: DealFormProblems = {};
  for (const issue of result.error.issues) {
    const path = issue.path[0];
    if (path === 'title') problems.title = 'deals.form.errors.titleRequired';
    else if (path === 'value' || path === 'currency')
      problems.value = 'deals.form.errors.valueInvalid';
    else if (path === 'expectedCloseDate') problems.close = 'deals.form.errors.closeInvalid';
  }
  return problems;
}
