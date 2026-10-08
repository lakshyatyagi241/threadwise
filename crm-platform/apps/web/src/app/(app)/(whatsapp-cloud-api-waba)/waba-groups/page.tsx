import { GroupsScreen } from '@/features/whatsapp-cloud-api-waba/groups/groups-screen';

/** `/waba-groups?account=<number uuid>`: Reference's path and query name. The number defaults to the first connected one. */
export default async function WabaGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string | string[] }>;
}) {
  const { account } = await searchParams;
  return <GroupsScreen accountId={Array.isArray(account) ? account[0] : account} />;
}
