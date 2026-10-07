import { TeamChatScreen } from '@/features/team-chat';

/** `?c=<channel uuid>` opens that channel or direct message (a notification's link); anything else lands on #general. */
export default async function TeamChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { c } = await searchParams;
  const channel = typeof c === 'string' ? c : undefined;
  return <TeamChatScreen initialChannelId={channel} />;
}
