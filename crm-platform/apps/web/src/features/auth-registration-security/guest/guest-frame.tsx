import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';
import type { ReactNode } from 'react';
import { authLocales } from './auth-locales';
import { AuthShell, type FixedPanel, type ShellHeader } from './auth-shell';
import { frameProps } from './frame-props';
import { GuestToolbar } from './guest-toolbar';

/** A guest page wrapped in the guest design: config in, `AuthShell` out. */
export function GuestFrame({
  page,
  config,
  header,
  fixedPanel,
  children,
}: {
  page: AuthPageName;
  config: RegistrationConfigResponse;
  header?: ShellHeader | null;
  /** Pages with a fixed panel (reset password, link landings) bring their own words for the dark side. */
  fixedPanel?: FixedPanel;
  children: ReactNode;
}) {
  return (
    <AuthShell
      {...frameProps(config, page)}
      page={page}
      header={header}
      fixedPanel={fixedPanel}
      toolbar={<GuestToolbar locales={authLocales()} />}
    >
      {children}
    </AuthShell>
  );
}
