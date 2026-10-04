import {
  createMarketRequestSchema,
  type CreateMarketRequestInput,
  type MarketAppKind,
  type MarketRequest,
  type MarketRequestResult,
} from '@crm/contracts';

/** "Request an integration": the form, the answer of asking, and the optimistic vote. */

export const REQUEST_NAME_MIN = 2;
export const REQUEST_NAME_MAX = 80;
export const REQUEST_NOTE_MAX = 500;
export const REQUEST_SORTS = ['votes', 'new'] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

export interface RequestDraft {
  name: string;
  kind: MarketAppKind;
  categorySlug: string;
  website: string;
  note: string;
}

export const emptyRequestDraft = (kind: MarketAppKind = 'integration'): RequestDraft => ({
  name: '',
  kind,
  categorySlug: '',
  website: '',
  note: '',
});

export type RequestField = 'name' | 'website' | 'note';
export type RequestProblem = 'nameShort' | 'nameLong' | 'websiteInvalid' | 'noteLong';

/** Problems by field, checked with the contract's own schema so the form and the API cannot disagree. */
export function validateRequest(
  draft: RequestDraft,
): Partial<Record<RequestField, RequestProblem>> {
  const out: Partial<Record<RequestField, RequestProblem>> = {};
  const name = draft.name.trim();
  if (name.length < REQUEST_NAME_MIN) out.name = 'nameShort';
  else if (name.length > REQUEST_NAME_MAX) out.name = 'nameLong';
  if (draft.note.trim().length > REQUEST_NOTE_MAX) out.note = 'noteLong';
  if (draft.website.trim() !== '') {
    const site = createMarketRequestSchema.shape.website.safeParse(draft.website.trim());
    if (!site.success) out.website = 'websiteInvalid';
  }
  return out;
}

/** The POST body: optional fields left out when empty. */
export function toRequestBody(draft: RequestDraft): CreateMarketRequestInput {
  const body: CreateMarketRequestInput = { name: draft.name.trim(), kind: draft.kind };
  if (draft.categorySlug) body.categorySlug = draft.categorySlug;
  if (draft.website.trim()) body.website = draft.website.trim();
  if (draft.note.trim()) body.note = draft.note.trim();
  return body;
}

/** `created: false` means somebody already asked and this ask was counted as a vote. */
export type AskOutcome = 'created' | 'counted';
export const askOutcome = (r: Pick<MarketRequestResult, 'created'>): AskOutcome =>
  r.created ? 'created' : 'counted';

/** The request as it will look after a vote is cast or taken back, for the optimistic update. */
export function withVote(request: MarketRequest, vote: boolean): MarketRequest {
  if (request.hasVoted === vote) return request;
  return {
    ...request,
    hasVoted: vote,
    voteCount: Math.max(0, request.voteCount + (vote ? 1 : -1)),
  };
}

/** Replaces one request in a list of pages (the shape the infinite query keeps) without touching the others. */
export function replaceRequest<P extends { data: MarketRequest[] }>(
  pages: readonly P[],
  next: MarketRequest,
): P[] {
  return pages.map((p) => ({ ...p, data: p.data.map((r) => (r.id === next.id ? next : r)) }));
}

/** Everything the request status chip can say, with its tone. */
export const REQUEST_STATUS_TONE = {
  open: 'neutral',
  planned: 'success',
  building: 'warning',
  shipped: 'success',
  declined: 'danger',
} as const;
