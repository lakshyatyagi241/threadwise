import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';
import type { ReactNode } from 'react';
import { AuthShell, type ShellHeader } from './auth-shell';
import { GuestToolbar } from './guest-toolbar';

/** A guest page wrapped in the design the admin picked: config in, `AuthShell` out. */
export function GuestFrame({
  page,
  config,
  header,
  variant,
  children,
}: {
  page: AuthPageName;
  config: RegistrationConfigResponse;
  header?: ShellHeader;
  /** Pages with a fixed design (reset password, link landings) ignore the admin's choice. */
  variant?: number;
  children: ReactNode;
}) {
  const pages = config.authPages;
  return (
    <AuthShell
      variant={variant ?? pages.variant}
      page={page}
      content={pages[page]}
      defaulted={pages.defaulted[page]}
      extra={page === 'forgot' ? undefined : pages.extra[page]}
      appName={config.appName}
      header={header}
      toolbar={<GuestToolbar />}
    >
      {children}
    </AuthShell>
  );
}
