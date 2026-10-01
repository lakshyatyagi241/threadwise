import { notFound } from 'next/navigation';
import { ContactDetail } from '@/features/contacts-attributes-tags/components/contact-detail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ContactDetail id={id} />;
}
