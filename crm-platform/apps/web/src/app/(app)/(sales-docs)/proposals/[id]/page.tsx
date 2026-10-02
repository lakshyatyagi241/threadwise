import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BuilderScreen } from '@/features/sales-docs';

const ID = /^[0-9A-Za-z_-]{1,64}$/;

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  return (
    <Suspense>
      <BuilderScreen kind="proposal" docId={id} />
    </Suspense>
  );
}
