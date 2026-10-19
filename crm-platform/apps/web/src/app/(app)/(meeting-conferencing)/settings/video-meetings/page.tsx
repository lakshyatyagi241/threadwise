import { Suspense } from 'react';
import { VideoMeetingsScreen } from '@/features/meeting-conferencing/components/video-meetings-screen';

export default function VideoMeetingsPage() {
  // The screen reads the address (`useSearchParams`) for the outcome the provider's callback leaves, which needs a Suspense boundary.
  return (
    <Suspense>
      <VideoMeetingsScreen />
    </Suspense>
  );
}
