import type {
  CreateWebhookTargetInput,
  UpdateWebhookTargetInput,
  WebhookTargetItem,
} from '@crm/contracts';

export interface TargetDraft {
  name: string;
  url: string;
  headerName: string;
  headerValue: string;
  removeHeader: boolean;
  fieldFilter: string[];
  timeoutSeconds: string;
  maxAttempts: string;
  isActive: boolean;
}

export type DraftField =
  'name' | 'url' | 'headerName' | 'headerValue' | 'timeoutSeconds' | 'maxAttempts';

/** Message-key suffix under `dialog.errors` for each problem the form can find before calling the API. */
export type DraftErrorKey =
  | 'nameRequired'
  | 'urlRequired'
  | 'urlHttps'
  | 'headerNameInvalid'
  | 'headerValueRequired'
  | 'headerNameRequired'
  | 'timeout'
  | 'maxAttempts';

export type DraftProblems = Partial<Record<DraftField, DraftErrorKey>>;

export const EMPTY_DRAFT: TargetDraft = {
  name: '',
  url: '',
  headerName: '',
  headerValue: '',
  removeHeader: false,
  fieldFilter: [],
  timeoutSeconds: '10',
  maxAttempts: '5',
  isActive: true,
};

export function draftFromTarget(item: WebhookTargetItem): TargetDraft {
  return {
    name: item.name,
    url: item.url,
    headerName: item.authHeaderName ?? '',
    headerValue: '',
    removeHeader: false,
    fieldFilter: [...item.fieldFilter],
    timeoutSeconds: String(Math.round(item.timeoutMs / 1000)),
    maxAttempts: String(item.maxAttempts),
    isActive: item.isActive,
  };
}

/** Whole number in [min, max], or null. */
function whole(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** Adds a tag the way the filter input does: trimmed, no duplicates, empty ignored. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = raw.trim();
  return tag === '' || tags.includes(tag) ? tags : [...tags, tag];
}

function check(
  draft: TargetDraft,
  saved: WebhookTargetItem | null,
): { problems: DraftProblems; seconds: number; attempts: number } {
  const problems: DraftProblems = {};
  if (draft.name.trim() === '') problems.name = 'nameRequired';
  const url = draft.url.trim();
  if (url === '') problems.url = 'urlRequired';
  else if (!/^https:\/\/\S+$/i.test(url)) problems.url = 'urlHttps';

  const headerName = draft.headerName.trim();
  const hasValue = draft.headerValue !== '';
  if (headerName !== '' && !/^[A-Za-z0-9-]+$/.test(headerName)) {
    problems.headerName = 'headerNameInvalid';
  } else if (!draft.removeHeader) {
    const keepsSaved = saved?.hasAuthHeader === true && headerName === saved.authHeaderName;
    if (headerName !== '' && !hasValue && !keepsSaved) problems.headerValue = 'headerValueRequired';
    if (headerName === '' && hasValue) problems.headerName = 'headerNameRequired';
  }

  const seconds = whole(draft.timeoutSeconds, 1, 30);
  if (seconds === null) problems.timeoutSeconds = 'timeout';
  const attempts = whole(draft.maxAttempts, 1, 10);
  if (attempts === null) problems.maxAttempts = 'maxAttempts';
  return { problems, seconds: seconds ?? 0, attempts: attempts ?? 0 };
}

export function toCreateBody(
  draft: TargetDraft,
): { body: CreateWebhookTargetInput } | { problems: DraftProblems } {
  const { problems, seconds, attempts } = check(draft, null);
  if (Object.keys(problems).length > 0) return { problems };
  const headerName = draft.headerName.trim();
  return {
    body: {
      name: draft.name.trim(),
      url: draft.url.trim(),
      isActive: draft.isActive,
      ...(headerName !== ''
        ? { authHeaderName: headerName, authHeaderValue: draft.headerValue }
        : {}),
      fieldFilter: draft.fieldFilter,
      timeoutMs: seconds * 1000,
      maxAttempts: attempts,
    },
  };
}

/** Sends only what changed, so an untouched URL is not re-checked and an untouched header value is kept. */
export function toUpdateBody(
  saved: WebhookTargetItem,
  draft: TargetDraft,
): { body: UpdateWebhookTargetInput } | { problems: DraftProblems } {
  const { problems, seconds, attempts } = check(draft, saved);
  if (Object.keys(problems).length > 0) return { problems };
  const body: UpdateWebhookTargetInput = { rowVersion: saved.rowVersion };
  if (draft.name.trim() !== saved.name) body.name = draft.name.trim();
  if (draft.url.trim() !== saved.url) body.url = draft.url.trim();
  if (draft.isActive !== saved.isActive) body.isActive = draft.isActive;
  if (draft.fieldFilter.join('\n') !== saved.fieldFilter.join('\n')) {
    body.fieldFilter = draft.fieldFilter;
  }
  if (seconds * 1000 !== saved.timeoutMs) body.timeoutMs = seconds * 1000;
  if (attempts !== saved.maxAttempts) body.maxAttempts = attempts;
  const headerName = draft.headerName.trim();
  if (draft.removeHeader) {
    if (saved.hasAuthHeader) body.removeAuthHeader = true;
  } else if (draft.headerValue !== '') {
    body.authHeaderName = headerName;
    body.authHeaderValue = draft.headerValue;
  } else if (headerName !== (saved.authHeaderName ?? '') && headerName === '') {
    body.removeAuthHeader = true;
  }
  return { body };
}

/** Maps a server field path (from problem+json `errors`) to the form field it belongs to. */
export function fieldForPath(path: string): DraftField | null {
  switch (path) {
    case 'name':
    case 'url':
      return path;
    case 'authHeaderName':
      return 'headerName';
    case 'authHeaderValue':
      return 'headerValue';
    case 'timeoutMs':
      return 'timeoutSeconds';
    case 'maxAttempts':
      return path;
    default:
      return null;
  }
}
