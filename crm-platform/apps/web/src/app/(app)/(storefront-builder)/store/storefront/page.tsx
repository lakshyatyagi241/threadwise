import { Suspense } from 'react';
import { SettingsScreen } from '@/features/storefront-builder/admin/components/settings-screen';

export default function StorefrontSettingsPage() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
