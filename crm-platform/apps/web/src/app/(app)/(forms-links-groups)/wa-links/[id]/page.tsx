import { WaLinkEditScreen } from '@/features/forms-links-groups/wa-links/wa-link-builder-screen';

export default async function WaLinkEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WaLinkEditScreen id={id} />;
}
