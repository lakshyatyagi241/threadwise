'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@crm/ui';
import { WizardScreen } from './wizard-screen';

/** The platform this domain answers for on `/connect`. The other platforms belong to the channel screens. */
export const WA_STORE_PLATFORM = 'wa-store';

/**
 * `/connect`: shows the shop wizard for `?platform=wa-store`. Any other value is a channel connection, which lives on the
 * channels screen, so the person is sent there.
 */
export function ConnectScreen() {
  const router = useRouter();
  const platform = useSearchParams().get('platform');
  const isStore = platform === WA_STORE_PLATFORM;

  useEffect(() => {
    if (!isStore) router.replace('/channels/whatsapp');
  }, [isStore, router]);

  return isStore ? (
    <WizardScreen />
  ) : (
    <div className="flex justify-center py-16" role="status" aria-busy="true">
      <Spinner />
    </div>
  );
}
