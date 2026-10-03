import { Suspense } from 'react';
import { ProductsScreen } from '@/features/catalog-products';

export default function ProductsPage() {
  // The screen reads the search and the page from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <ProductsScreen />
    </Suspense>
  );
}
