import {
  CAMPAIGN_IN_FLIGHT_STATUSES,
  type CampaignDetail,
  type CampaignLive,
} from '@crm/contracts';

/**
 * How the detail page follows a campaign. While it is scheduled or running the light live read is asked every 12 seconds (the tab
 * must be visible: react-query pauses a hidden tab); once it is at rest the live read stops and the heavy detail slows down, since
 * only late replies and clicks still arrive.
 */
export const LIVE_POLL_MS = 12_000;
export const DETAIL_POLL_IN_FLIGHT_MS = 30_000;
export const DETAIL_POLL_AT_REST_MS = 60_000;

export const isInFlight = (status: string | undefined): boolean =>
  status !== undefined && (CAMPAIGN_IN_FLIGHT_STATUSES as readonly string[]).includes(status);

/** The interval of the live read: keep asking until the server says the campaign is at rest. */
export const liveInterval = (data: Pick<CampaignLive, 'inFlight'> | undefined): number | false =>
  data && !data.inFlight ? false : LIVE_POLL_MS;

/** The interval of the heavy detail read. */
export const detailInterval = (status: string | undefined): number =>
  isInFlight(status) ? DETAIL_POLL_IN_FLIGHT_MS : DETAIL_POLL_AT_REST_MS;

/** What is still waiting to go out and what a run holds right now, as `[kind, count]` for the parts that are not zero. */
export function waiting(
  f: Pick<Freshest, 'queued' | 'processing'>,
): Array<['queued' | 'processing', number]> {
  const out: Array<['queued' | 'processing', number]> = [];
  if ((f.queued ?? 0) > 0) out.push(['queued', f.queued ?? 0]);
  if ((f.processing ?? 0) > 0) out.push(['processing', f.processing ?? 0]);
  return out;
}

export interface Freshest {
  status: string;
  counts: CampaignDetail['campaign']['counts'];
  rates: CampaignDetail['rates'];
  /** Null until a live read has come back: the detail does not carry them. */
  queued: number | null;
  processing: number | null;
  /** When the numbers on screen were read, if they came from a live read. */
  fetchedAt: string | null;
}

/**
 * The numbers to show. A live read is lighter and newer, so it wins, but only while it really is the newer of the two reads: once the
 * campaign is at rest the live read stops and a later detail read (late replies, clicks) must not be hidden behind it.
 */
export function freshest(
  detail: CampaignDetail,
  detailUpdatedAt: number,
  live: CampaignLive | undefined,
  liveUpdatedAt: number,
): Freshest {
  if (live && liveUpdatedAt >= detailUpdatedAt) {
    return {
      status: live.status,
      counts: live.counts,
      rates: live.rates,
      queued: live.queued,
      processing: live.processing,
      fetchedAt: live.fetchedAt,
    };
  }
  return {
    status: detail.campaign.status,
    counts: detail.campaign.counts,
    rates: detail.rates,
    queued: null,
    processing: null,
    fetchedAt: null,
  };
}
