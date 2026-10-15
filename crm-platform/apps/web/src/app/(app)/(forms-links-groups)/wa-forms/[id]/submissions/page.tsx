import { WaFormSubmissionsScreen } from '@/features/forms-links-groups/wa-forms/wa-form-submissions-screen';

export default async function WaFormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WaFormSubmissionsScreen id={id} />;
}
