import type { CampaignSummary } from '@crm/contracts';

/** A finished campaign's summary with only what a test names changed. */
export function summaryFixture(over: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'campaign',
    name: 'Open day 2026',
    status: 'completed',
    sentAt: '2026-10-01T09:00:00.000Z',
    window: { days: 7, from: '2026-10-01T09:00:00.000Z', to: '2026-10-08T09:00:00.000Z' },
    people: { messaged: 1240, delivered: 1150, read: 810, failed: 90, notTrackable: 0 },
    cameBack: { count: 164, pctOfMessaged: 13.2, pctOfDelivered: 14.3, medianHoursToReply: 3.5 },
    filledForm: {
      count: 31,
      pctOfMessaged: 2.5,
      alsoWroteBack: 20,
      viaWebForm: 25,
      viaWhatsappForm: 6,
      formsCounted: [],
      allForms: true,
    },
    cameBackByDay: [
      { day: '2026-10-01', count: 20 },
      { day: '2026-10-02', count: 90 },
      { day: '2026-10-03', count: 54 },
    ],
    caveats: [],
    ...over,
  };
}
