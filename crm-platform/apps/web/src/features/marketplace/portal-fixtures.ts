import type {
  MarketAppCard,
  MarketAppDetail,
  MarketConnectionView,
  MarketInstallation,
} from '@crm/contracts';
import { HOOK_URL, ID, card, detail, installation } from './test-fixtures';

/** Fixtures of the lead-portal listings (a push portal with a private address, a polled portal): builders with overrides, never imported by app code. */

/** The secret that is the last segment of a private address in the tests, and the tail the manage page may show of it. */
export const PATH_SECRET = 'pathsecret9f8e7d6c5b4a3928170615ab12';
export const PATH_TAIL = 'ab12';
export const PATH_FULL = `${HOOK_URL}/${PATH_SECRET}`;

/** The notice of a beta listing and of a listing that only works once the portal's own team has switched it on. */
export const BETA_NOTICE = 'Built from the portal documentation; check the first lead it brings.';
export const SETUP_NOTICE =
  'The portal team switches this on, not you: send the private address to your account manager.';

export function portalCard(over: Partial<MarketAppCard> = {}): MarketAppCard {
  return card({
    id: ID(2),
    slug: 'justdial',
    name: 'JustDial',
    tagline: 'Leads from JustDial arrive in your inbox as they are received.',
    category: { slug: 'lead-portals', name: 'Lead portals' },
    connectorType: 'push',
    firstParty: false,
    maturity: 'needs_portal_setup',
    notice: SETUP_NOTICE,
    ...over,
  });
}

export function portalDetail(over: Partial<MarketAppDetail> = {}): MarketAppDetail {
  const base = detail();
  return {
    ...base,
    ...portalCard(),
    description: 'Receive JustDial enquiries as leads.',
    listing: { ...base.listing, maturity: 'needs_portal_setup', notice: SETUP_NOTICE },
    setup: {
      connectorType: 'push',
      authFields: [],
      setupInstructions: [
        {
          title: 'Ask for the delivery',
          body: 'Send the private address to your account manager.',
        },
      ],
      hasTestPayload: true,
    },
    ...over,
  };
}

/** A connection view with every portal field; pass fields to change it. Defaults to a push connection with a private address. */
export function portalConnection(over: Partial<MarketConnectionView> = {}): MarketConnectionView {
  return {
    id: ID(60),
    type: 'push',
    status: 'active',
    inbound: {
      url: HOOK_URL,
      method: 'GET',
      auth: 'path',
      tokenHeader: 'X-Marketplace-Token',
      signatureHeader: 'X-Marketplace-Signature',
      secretHint: `ends in ${PATH_TAIL}`,
      methods: ['GET', 'POST'],
      formats: ['query', 'form', 'json'],
      delivery: 'async',
    },
    pollIntervalSeconds: null,
    lastEventAt: '2026-10-02T09:00:00.000Z',
    lastSuccessAt: '2026-10-02T09:00:00.000Z',
    lastError: null,
    counters: { received: 5, accepted: 4, duplicates: 1, failed: 0 },
    ...over,
  };
}

/** JustDial: a push portal, private address as the secret. No lead has arrived yet unless `lastEventAt` says so. */
export function pathInstallation(
  over: Partial<MarketInstallation> = {},
  connection: Partial<MarketConnectionView> = {},
): MarketInstallation {
  return installation({
    app: {
      id: ID(2),
      slug: 'justdial',
      name: 'JustDial',
      kind: 'integration',
      logo: null,
      category: { slug: 'lead-portals', name: 'Lead portals' },
      connectorType: 'push',
    },
    credentials: [],
    connection: portalConnection({ lastEventAt: null, lastSuccessAt: null, ...connection }),
    ...over,
  });
}

/** IndiaMART: a polled portal (a key we fetch with) that also has a push address. */
export function pullInstallation(
  over: Partial<MarketInstallation> = {},
  connection: Partial<MarketConnectionView> = {},
): MarketInstallation {
  return installation({
    app: {
      id: ID(3),
      slug: 'indiamart',
      name: 'IndiaMART',
      kind: 'integration',
      logo: null,
      category: { slug: 'lead-portals', name: 'Lead portals' },
      connectorType: 'pull',
    },
    credentials: [
      { key: 'crmKey', label: 'CRM key', kind: 'secret', isSet: true, hint: 'ends in 77aa' },
    ],
    connection: portalConnection({
      type: 'pull',
      inbound: {
        url: HOOK_URL,
        method: 'POST',
        auth: 'either',
        tokenHeader: 'X-Marketplace-Token',
        signatureHeader: 'X-Marketplace-Signature',
        secretHint: 'ends in cdef',
        methods: ['POST'],
        formats: ['json'],
        delivery: 'sync',
      },
      pollIntervalSeconds: 300,
      nextPollAt: '2026-10-04T10:05:00.000Z',
      syncedThrough: '2026-10-04T09:58:00.000Z',
      minSyncIntervalSeconds: 300,
      ...connection,
    }),
    ...over,
  });
}
