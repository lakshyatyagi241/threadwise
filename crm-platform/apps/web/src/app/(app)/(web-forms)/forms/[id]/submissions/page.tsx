import { SubmissionsScreen } from '@/features/web-forms/components/submissions-screen';

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubmissionsScreen formId={id} />;
}
