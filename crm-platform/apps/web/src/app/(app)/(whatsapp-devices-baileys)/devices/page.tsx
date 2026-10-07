import { UnofficialTabs } from '@/features/whatsapp-devices-baileys/components/unofficial-tabs';
import { DevicesScreen } from '@/features/whatsapp-devices-baileys/components/devices-screen';

export default function DevicesPage() {
  return (
    <>
      <UnofficialTabs active="numbers" />
      <DevicesScreen />
    </>
  );
}
