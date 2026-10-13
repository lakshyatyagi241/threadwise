import { Suspense } from 'react';
import { CallAnalyticsScreen } from '@/features/calling-voice/components/call-analytics-screen';

export default function CallAnalyticsPage() {
  return (
    <Suspense>
      <CallAnalyticsScreen />
    </Suspense>
  );
}
