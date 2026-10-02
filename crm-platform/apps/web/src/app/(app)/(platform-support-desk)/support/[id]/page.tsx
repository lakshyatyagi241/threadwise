import { TicketThread } from '@/features/platform-support-desk/customer/ticket-thread';

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketThread id={id} />;
}
