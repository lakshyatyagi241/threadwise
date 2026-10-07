import { BuilderScreen } from '@/features/web-forms/components/builder-screen';

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuilderScreen formId={id} />;
}
