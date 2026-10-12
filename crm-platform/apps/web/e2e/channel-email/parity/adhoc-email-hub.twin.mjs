// Ours-only twin for the Gmail email hub (/email). Reference has no native email screen (it bridges to an external product and lists
// mailboxes in its Devices table), so there is nothing to compare against: the page probes run against absolute expectations (no console
// or page errors, accessibility, keyboard, degraded data requests, anonymous access, responsive layout) and a script-typed value never runs.
export default (h) => ({
  feature: 'adhoc:email-hub',
  title: 'Gmail email hub (ours only)',
  pages: [
    {
      id: 'email-hub',
      title: 'Email hub',
      path: '/email',
      ready: { threadwise: 'main', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [],
  intended: [
    {
      scenario: /email-hub\.responsive/,
      key: /^low\.smallTargets\./,
      quirk: 'shared Settings breadcrumb (settings-hub) draws two 19-20px links above every Settings tile screen',
      reason: 'not part of the email screen and outside its zone; shared by every tile (follow-up for settings-hub)',
    },
    {
      scenario: /email-hub\.a11y/,
      key: /^low\.a11y\.moderate$/,
      quirk: 'the app shell has two landmarks without distinct labels (landmark-unique)',
      reason: 'raised by the shell navigation, not by the email screen; shared by every screen (follow-up for the shell)',
    },
  ],
  skip: [],
});
