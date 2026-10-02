import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';
import type { ReactNode } from 'react';
import { authLocales } from './auth-locales';
import { AuthShell, type FixedPanel, type ShellHeader } from './auth-shell';
import { frameProps } from './frame-props';
import { GuestToolbar } from './guest-toolbar';

/** A guest page wrapped in the design the admin picked: config in, `AuthShell` out. */
export function GuestFrame({
  page,
  config,
  header,
  variant,
  fixedPanel,
  children,
}: {
  page: AuthPageName;
  config: RegistrationConfigResponse;
  header?: ShellHeader | null;
  /** Overrides the admin's design for one page (the OTP and social-callback pages follow the sign-in look). */
  variant?: number;
  /** Pages with a fixed design (reset password, link landings) ignore the admin's choice and bring their own panel. */
  fixedPanel?: FixedPanel;
  children: ReactNode;
}) {
  return (
    <AuthShell
      {...frameProps(config, page, variant)}
      page={page}
      header={header}
      fixedPanel={fixedPanel}
      toolbar={<GuestToolbar locales={authLocales()} />}
    >
      {children}
    </AuthShell>
  );
}
