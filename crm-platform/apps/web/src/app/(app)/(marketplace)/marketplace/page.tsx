import { redirect } from 'next/navigation';

/** `/marketplace` opens on the Integrations tab (where the lead sources are); the Mini apps tab is one click away. */
export default function MarketplaceIndexPage() {
  redirect('/marketplace/integrations');
}
