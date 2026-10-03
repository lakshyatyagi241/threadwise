import { Suspense } from 'react';
import { PostsScreen } from '@/features/channel-facebook/components/posts-screen';

export default function FacebookPostsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <PostsScreen />
    </Suspense>
  );
}
