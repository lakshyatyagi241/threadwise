import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveWaChatLink } from '@/features/forms-links-groups/wa-links/public/server';
import { WaLinkUnavailable } from '@/features/forms-links-groups/wa-links/public/wa-link-unavailable';

/**
 * The public click-to-chat short link (Reference `GET /l/{slug}`; docs/threadwise-port/inventory/forms-links-groups.md
 * TW-WFL-017). The API owns the redirect itself (`WaChatLinkRedirectController`), but the "Short link" the builder
 * shows is this web app's own origin (`window.location.origin` + `/l/<slug>`), which has no route to the API — this
 * page is that route: it resolves the slug server-side and forwards the visitor straight into WhatsApp.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function WaChatLinkRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveWaChatLink(slug);
  if (result.status === 'missing') return <WaLinkUnavailable kind="missing" />;
  if (result.status === 'gone') return <WaLinkUnavailable kind="gone" />;
  if (result.status === 'unavailable') return <WaLinkUnavailable kind="error" />;
  redirect(result.url);
}
