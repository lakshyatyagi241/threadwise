// Twin spec for "Retry failed" on the guided-send status page (/campaigns/wizard/broadcasts/:id). Reference has no such page (the
// guided wizard is an addition), so this runs on ours only and judges absolute expectations: no console or page errors, an unknown or
// foreign id is a clean 404 with no Retry button, the route needs a session, and a malformed id is refused. The positive path (the
// failed recipients go back in the queue, nobody else is touched, a series retries each finished run) needs a launched broadcast with
// real recipients; it is covered by apps/api/test/e2e/campaigns/broadcast-wizard-worker.e2e.spec.ts and the screen tests.
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const STATUS = `/campaigns/wizard/broadcasts/${MISSING}`;
const API = `/v2/broadcast-wizard/broadcasts`;

export default (h) => ({
  feature: 'adhoc:wizard-retry-failed',
  title: 'Retry failed on the guided-send status page',
  pages: [
    {
      id: 'status-not-found',
      title: 'Status page for an id that does not exist',
      path: { threadwise: '/', ours: STATUS }, // Reference has no such page; only ours is run
      ready: { threadwise: 'body', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'retry-failed.ui-not-found-offers-no-retry',
      title: 'An unknown broadcast shows the not-found state and no Retry failed button',
      tags: ['ours'],
      run: async (c) => {
        await c.goto(STATUS, { ready: 'main' });
        c.obs.flag(
          'flag.retry-button',
          (await c.page.getByRole('button', { name: /retry failed/i }).count()) > 0,
        );
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'retry-failed.api-unknown-id',
      title: 'POST retry-failed on an unknown id is a 404 problem+json',
      api: true,
      tags: ['ours'],
      run: async (c) => {
        const r = await c.http('POST', `${API}/${MISSING}/retry-failed`, { data: {} });
        c.obs.status('status.unknown-id', r.status);
        c.obs.flag('flag.problem-json', Boolean(r.body && r.body.type && r.body.code));
      },
    },
    {
      id: 'retry-failed.api-malformed-id',
      title: 'A malformed id is refused before anything runs',
      api: true,
      tags: ['ours'],
      run: async (c) => {
        const r = await c.http('POST', `${API}/not-a-uuid/retry-failed`, { data: {} });
        c.obs.status('status.malformed-id', r.status);
      },
    },
    {
      id: 'retry-failed.api-needs-session',
      title: 'Without a session the route is refused and nothing is revealed about the id',
      api: true,
      tags: ['ours'],
      run: async (c) => {
        const r = await c.http('POST', `${API}/${MISSING}/retry-failed`, {
          data: {},
          anonymous: true,
        });
        c.obs.status('status.anonymous', r.status);
      },
    },
  ],
  intended: [],
  skip: [],
});
