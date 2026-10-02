import { Suspense } from 'react';
import { BuilderScreen } from '@/features/sales-docs';

export default function NewProposalPage() {
  // The builder reads `?contact=` and `?deal=` (a new proposal started from a contact or a deal).
  return (
    <Suspense>
      <BuilderScreen kind="proposal" />
    </Suspense>
  );
}
