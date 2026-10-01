import { socialProviderSchema } from '@crm/contracts';
import { notFound } from 'next/navigation';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { SocialCallback } from '@/features/auth-registration-security/guest/social-callback';
import {
  firstParam,
  guestHeader,
  guestMetadata,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('socialCallback');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The provider sends the browser back here with `code` and `state` (or `error`): WD-AUTH-004. */
export default async function SocialCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: SearchParams;
}) {
  const parsed = socialProviderSchema.safeParse((await params).provider);
  if (!parsed.success) notFound();
  const sp = await searchParams;
  const config = await loadRegistrationConfig();
  return (
    <GuestFrame
      page="login"
      variant={3}
      config={config}
      header={await guestHeader('socialCallback')}
    >
      <SocialCallback
        provider={parsed.data}
        code={firstParam(sp.code)}
        state={firstParam(sp.state)}
        providerError={firstParam(sp.error)}
      />
    </GuestFrame>
  );
}
