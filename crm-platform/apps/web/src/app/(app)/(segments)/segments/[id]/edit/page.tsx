import { notFound } from 'next/navigation';
import { SegmentBuilder } from '@/features/segments/components/segment-builder';
import { isUuid } from '@/features/segments/lib/url';

export default async function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <SegmentBuilder id={id} />;
}
