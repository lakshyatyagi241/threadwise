import { redirect } from 'next/navigation';

/** `/integrations` was the planned Settings tile and the catalog screen's back link; connecting a service now starts in the Marketplace. */
export default function IntegrationsRedirectPage() {
  redirect('/marketplace/integrations');
}
