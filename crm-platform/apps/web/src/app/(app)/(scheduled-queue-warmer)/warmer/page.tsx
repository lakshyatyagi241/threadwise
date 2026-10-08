import { UnofficialTabs } from '@/features/whatsapp-devices-baileys/components/unofficial-tabs';
import { WarmerScreen } from '@/features/scheduled-queue-warmer/components/warmer-screen';

export default function WarmerPage() {
  return (
    <>
      <UnofficialTabs active="warmer" />
      <WarmerScreen />
    </>
  );
}
