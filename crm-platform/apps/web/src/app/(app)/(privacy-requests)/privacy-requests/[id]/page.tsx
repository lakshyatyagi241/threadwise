import { RequestDetailScreen } from '@/features/privacy-requests/components/request-detail-screen';

export default async function PrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetailScreen id={id} />;
}
