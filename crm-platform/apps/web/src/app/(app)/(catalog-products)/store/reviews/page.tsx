import { Suspense } from 'react';
import { ReviewsScreen } from '@/features/catalog-products';

export default function ReviewsPage() {
  // The screen reads the status tab and the page from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <ReviewsScreen />
    </Suspense>
  );
}
