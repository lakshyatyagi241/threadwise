import { Suspense } from 'react';
import { CreditNoteBuilder } from '@/features/invoicing/components/credit-notes-builder';

export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CreditNoteBuilder id={id} />
    </Suspense>
  );
}
