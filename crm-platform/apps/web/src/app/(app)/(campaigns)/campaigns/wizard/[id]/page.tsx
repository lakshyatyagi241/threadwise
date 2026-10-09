import { notFound, redirect } from 'next/navigation';
import { createPath, draftParam } from '@/features/campaigns/lib/create-flow';

/** A guided draft resumes on Campaigns, Create now; the old address keeps working. */
export default async function OldResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = draftParam(id);
  if (!draft) notFound();
  redirect(createPath({ draft }));
}
