// Worked example of a page-level twin spec: the same screens opened on both apps, every page probe run on each.
// No form is submitted and nothing is written, so it is safe against any environment. Page probes need no feature
// knowledge: they compare load noise, structure, responsive behaviour, a11y, keyboard, failure states and timing.
//   public: true  -> opened without a session (login, signup); the "without a session" probe is skipped
//   path          -> one string when both apps use the same route, or {threadwise, ours}
//   ready         -> something that proves the page has rendered (per side when the markup differs)
export default (h) => ({
  feature: 'adhoc:example-pages',
  title: 'Login and contacts screens, both apps',
  pages: [
    {
      id: 'login',
      title: 'Sign-in page',
      path: '/login',
      public: true,
      ready: { threadwise: 'input[type=password]', ours: 'input[type=password]' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'contacts',
      title: 'Contacts list',
      path: '/contacts',
      ready: { threadwise: 'table', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
});
