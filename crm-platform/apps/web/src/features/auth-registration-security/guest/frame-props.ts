import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';

/**
 * What a guest page hands its design from the public configuration: the admin's copy, the text fields they left
 * empty, and the showcase extras (hero card, closing line and, for sign-in and sign-up, stats, feature cards and the
 * checklist) of THAT page. The forgot-password page has its own extras (`authPages.extra.forgot`), exactly like the
 * other two, so a footer or hero the admin saved on the Forgot tab reaches the page visitors see.
 */
export function frameProps(
  config: RegistrationConfigResponse,
  page: AuthPageName,
  variant?: number,
) {
  const pages = config.authPages;
  return {
    variant: variant ?? pages.variant,
    content: pages[page],
    defaulted: pages.defaulted[page],
    extra: pages.extra[page],
    appName: config.appName,
    countryIso: config.defaultCountryIso,
  };
}
