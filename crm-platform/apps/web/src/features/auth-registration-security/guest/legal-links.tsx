'use client';

import type { RegistrationConfigResponse } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { safeUrl } from './safe-url';

type Links = RegistrationConfigResponse['links'];

/** Rich-text tags for `<terms>`, `<privacy>` and `<cookies>` in the legal messages. Unsafe addresses render as plain text. */
function legalTags(links: Links) {
  const anchor = (href: string | null) =>
    function Anchor(chunks: ReactNode) {
      const safe = safeUrl(href);
      if (!safe) return <span className="font-medium">{chunks}</span>;
      return (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        >
          {chunks}
        </a>
      );
    };
  return {
    terms: anchor(links.terms),
    privacy: anchor(links.privacy),
    cookies: anchor(links.cookies),
  };
}

/** "By signing in you agree to our Terms and Privacy policy", with the links from the platform settings. */
export function LegalLine({ links }: { links: Links }) {
  const t = useTranslations('auth-registration-security.guest.legal');
  const tags = legalTags(links);
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {t.rich('login', tags)}
      {links.cookies && <> {t.rich('cookies', tags)}</>}
    </p>
  );
}

/** The sign-up checkbox label: "I agree to the Terms and Privacy policy". */
export function AgreeLabel({ links }: { links: Links }) {
  const t = useTranslations('auth-registration-security.guest.legal');
  return <>{t.rich('signup', legalTags(links))}</>;
}
