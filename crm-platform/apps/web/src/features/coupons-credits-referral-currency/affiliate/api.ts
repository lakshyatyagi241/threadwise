import {
  referralHistoryResponseSchema,
  referralMeResponseSchema,
  referralSummaryResponseSchema,
  type ReferralBucket,
  type ReferralRange,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { fileNameFromDisposition } from './lib/download';

export const HISTORY_PAGE_SIZE = 20;

export const KEYS = {
  me: ['affiliate', 'me'] as const,
  summary: ['affiliate', 'summary'] as const,
  history: (range: ReferralRange, bucket: ReferralBucket, q: string, cursor: string | undefined) =>
    ['affiliate', 'history', range, bucket, q, cursor ?? 'first'] as const,
};

/** The signed-in person's own affiliate program (`/api/v2/affiliate/*`): no permission key, the data is theirs. */
export const affiliateApi = {
  me: (signal?: AbortSignal) =>
    apiFetch('/affiliate/me', { schema: referralMeResponseSchema, signal }),
  summary: (signal?: AbortSignal) =>
    apiFetch('/affiliate/summary', { schema: referralSummaryResponseSchema, signal }),
  history: (
    args: { range: ReferralRange; bucket: ReferralBucket; q: string; cursor: string | undefined },
    signal?: AbortSignal,
  ) =>
    apiFetch('/affiliate/history', {
      query: {
        range: args.range,
        bucket: args.bucket,
        q: args.q,
        limit: HISTORY_PAGE_SIZE,
        cursor: args.cursor,
      },
      schema: referralHistoryResponseSchema,
      signal,
    }),
};

/** Where the "Export CSV" link points for a range (search and bucket are not part of the export). */
export const exportHref = (range: ReferralRange): string =>
  `/api/v2/affiliate/export?range=${encodeURIComponent(range)}`;

/** The referrals of the range as CSV, under the file name the server chose. The link itself stays a real href. */
export async function downloadAffiliateCsv(
  range: ReferralRange,
  today = new Date(),
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(exportHref(range), {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.headers.get('x-request-id'));
  }
  return {
    blob: await res.blob(),
    fileName: fileNameFromDisposition(
      res.headers.get('content-disposition'),
      `affiliate-history-${today.toISOString().slice(0, 10).replaceAll('-', '')}.csv`,
    ),
  };
}
