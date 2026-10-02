import { Suspense } from 'react';
import { MyPostsScreen } from '@/features/channel-facebook/components/my-posts-screen';

export default function FacebookMyPostsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <MyPostsScreen />
    </Suspense>
  );
}
