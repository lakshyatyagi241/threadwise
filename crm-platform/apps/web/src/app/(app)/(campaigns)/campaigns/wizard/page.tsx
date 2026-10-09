import { redirect } from 'next/navigation';
import { createPath, senderParam } from '@/features/campaigns/lib/create-flow';

/** The guided flow lives on Campaigns, Create now; the old address keeps working. */
export default async function OldWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ sender?: string | string[] }>;
}) {
  const { sender } = await searchParams;
  redirect(createPath({ sender: senderParam(sender) }));
}
