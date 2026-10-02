import { notFound } from 'next/navigation';
import { SegmentDetail } from '@/features/segments/components/segment-detail';
import { isUuid } from '@/features/segments/lib/url';

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <SegmentDetail id={id} />;
}
