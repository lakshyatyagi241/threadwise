import { Suspense } from 'react';
import { ConnectScreen } from '@/features/storefront-builder/admin/components/connect-screen';

export default function ConnectPage() {
  // `?platform=wa-store` picks the shop wizard; the screen reads the address, so it needs a Suspense boundary.
  return (
    <Suspense>
      <ConnectScreen />
    </Suspense>
  );
}
