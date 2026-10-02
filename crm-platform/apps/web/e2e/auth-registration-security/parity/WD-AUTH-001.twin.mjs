// Twin spec: the guest pages (sign-in, sign-up, forgot password) opened on WaDesk and on our web app.
// Page probes only: no form is submitted and nothing is written, and no one signs in to either app, so this
// is safe against any environment. Forms with credentials are not fuzzed (lockouts); see the parity doc for
// the signed-in screens, which need someone to sign in to WaDesk first.
export default (h) => ({
  feature: 'WD-AUTH-001',
  title: 'Guest pages: sign-in, sign-up, forgot password',
  pages: [
    {
      id: 'login',
      title: 'Sign-in page',
      path: '/login',
      public: true,
      ready: { wadesk: 'input[type=password]', ours: 'input[type=password]' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'register',
      title: 'Sign-up page (step 1)',
      path: { wadesk: '/register', ours: '/signup' },
      public: true,
      ready: { wadesk: 'input[type=password]', ours: 'input[type=password]' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'forgot',
      title: 'Forgot password',
      path: '/forgot-password',
      public: true,
      ready: { wadesk: 'input[type=email]', ours: 'input[type=email]' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
});
