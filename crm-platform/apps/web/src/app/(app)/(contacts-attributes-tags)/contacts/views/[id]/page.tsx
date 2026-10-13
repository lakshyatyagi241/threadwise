import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ViewEditorScreen } from '@/features/contacts-attributes-tags/components/view-editor-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <Suspense>
      <ViewEditorScreen id={id} />
    </Suspense>
  );
}
