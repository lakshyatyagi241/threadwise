/** The providers' own setup guides, listed in the "Official documentation" card of the social login screen. */
export const OFFICIAL_DOCS = [
  { id: 'google', href: 'https://developers.google.com/identity/protocols/oauth2/web-server' },
  {
    id: 'facebook',
    href: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
  },
  { id: 'recaptchaAdmin', href: 'https://www.google.com/recaptcha/admin' },
  { id: 'recaptchaDocs', href: 'https://developers.google.com/recaptcha' },
] as const;
export type OfficialDocId = (typeof OFFICIAL_DOCS)[number]['id'];
