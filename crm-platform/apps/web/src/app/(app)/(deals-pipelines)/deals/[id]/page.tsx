import { redirect } from 'next/navigation';

/** `/deals/<id>` is a shareable link to one deal: it opens the board with that deal's drawer (`/deals?deal=<id>`). */
export default async function DealLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/deals?deal=${encodeURIComponent(id)}`);
}
