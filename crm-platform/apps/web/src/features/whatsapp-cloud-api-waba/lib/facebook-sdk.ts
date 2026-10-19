/** The Meta SDK loader lives in `@/lib/facebook-sdk` (the catalog login uses it too); this file keeps what is specific to Embedded Signup. */
import type { FbLoginOptions } from '@/lib/facebook-sdk';

export { loadFacebookSdk } from '@/lib/facebook-sdk';
export type { FbLoginOptions, FbLoginResponse, FbSdk } from '@/lib/facebook-sdk';

export function loginOptions(args: {
  configId: string;
  solutionId: string | null;
  coexistence: boolean;
}): FbLoginOptions {
  return {
    config_id: args.configId,
    response_type: 'code',
    override_default_response_type: true,
    extras: {
      // Interakt's tech-provider app needs its solution id; the direct-Meta route has none.
      setup: args.solutionId ? { solutionID: args.solutionId } : {},
      // Anything but '3' returns the legacy payload without waba_id.
      sessionInfoVersion: '3',
      ...(args.coexistence ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
    },
  };
}
