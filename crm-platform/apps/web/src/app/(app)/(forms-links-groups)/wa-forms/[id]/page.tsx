import { WaFormBuilderScreen } from '@/features/forms-links-groups/wa-forms/wa-form-builder-screen';

export default async function WaFormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WaFormBuilderScreen id={id} />;
}
