import { Suspense } from 'react';
import { CreditNoteDetail } from '@/features/invoicing/components/credit-note-detail';

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CreditNoteDetail id={id} />
    </Suspense>
  );
}
