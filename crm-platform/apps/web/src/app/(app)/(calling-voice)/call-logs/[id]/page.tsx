import { CallLogDetailScreen } from '@/features/calling-voice/components/call-log-detail-screen';

export default async function CallLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallLogDetailScreen callId={id} />;
}
