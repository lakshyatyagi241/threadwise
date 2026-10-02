import { Suspense } from 'react';
import { CreditNoteBuilder } from '@/features/invoicing/components/credit-notes-builder';

export default function NewCreditNotePage() {
  return (
    <Suspense>
      <CreditNoteBuilder />
    </Suspense>
  );
}
