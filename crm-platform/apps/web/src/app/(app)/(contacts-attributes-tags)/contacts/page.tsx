import { Suspense } from 'react';
import { ContactsScreen } from '@/features/contacts-attributes-tags/components/contacts-screen';

export default function ContactsPage() {
  // The screen reads the URL's filters, which needs a Suspense boundary.
  return (
    <Suspense>
      <ContactsScreen />
    </Suspense>
  );
}
