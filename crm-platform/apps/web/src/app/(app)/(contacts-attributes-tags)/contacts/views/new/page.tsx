import { Suspense } from 'react';
import { ViewEditorScreen } from '@/features/contacts-attributes-tags/components/view-editor-screen';

export default function NewViewPage() {
  return (
    <Suspense>
      <ViewEditorScreen />
    </Suspense>
  );
}
