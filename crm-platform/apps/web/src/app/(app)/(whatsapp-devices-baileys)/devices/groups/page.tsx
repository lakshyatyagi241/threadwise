import { UnofficialTabs } from '@/features/whatsapp-devices-baileys/components/unofficial-tabs';
import { GroupsScreen } from '@/features/whatsapp-devices-baileys/groups/groups-screen';

/** `/devices/groups?device=<number uuid>`: the Groups tab. The number defaults to the first connected one. */
export default async function DeviceGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string | string[] }>;
}) {
  const { device } = await searchParams;
  return (
    <>
      <UnofficialTabs active="groups" />
      <GroupsScreen deviceId={Array.isArray(device) ? device[0] : device} />
    </>
  );
}
