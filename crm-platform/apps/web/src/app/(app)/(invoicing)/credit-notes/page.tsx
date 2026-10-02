import { Suspense } from 'react';
import { CreditNotesScreen } from '@/features/invoicing/components/credit-notes-screen';

export default function CreditNotesPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <CreditNotesScreen />
    </Suspense>
  );
}
