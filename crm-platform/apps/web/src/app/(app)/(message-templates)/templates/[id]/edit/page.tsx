import { notFound } from 'next/navigation';
import { TemplateFormScreen } from '@/features/message-templates/components/template-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <TemplateFormScreen id={id} />;
}
