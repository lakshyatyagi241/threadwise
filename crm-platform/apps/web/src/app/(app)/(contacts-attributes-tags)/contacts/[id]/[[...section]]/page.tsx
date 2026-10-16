import { notFound } from 'next/navigation';
import { ContactDetail } from '@/features/contacts-attributes-tags/components/contact-detail';
import { parseSection } from '@/features/contacts-attributes-tags/lib/sections';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/contacts/<id>` is the overview; `/contacts/<id>/<section>` is one of the contact's sections (notes, files, deals ...). */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string; section?: string[] }>;
}) {
  const { id, section } = await params;
  if (!UUID.test(id)) notFound();
  if (section && section.length > 1) notFound();
  const parsed = section?.[0] ? parseSection(section[0]) : 'overview';
  if (!parsed) notFound();
  return <ContactDetail id={id} section={parsed} />;
}
