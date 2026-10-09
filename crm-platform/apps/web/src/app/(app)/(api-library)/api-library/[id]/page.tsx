import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ApiFormScreen } from '@/features/api-library/components/api-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditApiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <Suspense>
      <ApiFormScreen id={id} />
    </Suspense>
  );
}
