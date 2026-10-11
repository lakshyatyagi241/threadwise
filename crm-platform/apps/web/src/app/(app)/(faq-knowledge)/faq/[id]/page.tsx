import { notFound } from 'next/navigation';
import { FaqEditorScreen } from '@/features/faq-knowledge/components/editor-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditFaqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <FaqEditorScreen id={id} />;
}
