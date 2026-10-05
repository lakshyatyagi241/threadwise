import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { DocView } from '@/features/help-center/doc-view';
import { localized } from '@/features/help-center/resolve';
import { getVisibleHelp } from '@/features/help-center/server';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const view = await getVisibleHelp();
  const doc = view?.docs.find((d) => d.id === id);
  return doc ? { title: localized(doc, await getLocale()).title } : {};
}

/**
 * One guide. A guide the person cannot see (not on their plan, not their role, not built yet, or no such id) is a 404, the same as
 * a guide that does not exist, so the page never confirms it is there.
 */
export default async function HelpDocPage({ params }: Params) {
  const { id } = await params;
  const view = await getVisibleHelp();
  const doc = view?.docs.find((d) => d.id === id);
  const entry = view?.entries.find((e) => e.id === id);
  if (!view || !doc || !entry) notFound();

  const text = localized(doc, await getLocale());
  return (
    <DocView
      id={doc.id}
      area={doc.area}
      title={text.title}
      summary={text.summary}
      blocks={text.blocks}
      fallback={text.fallback}
      entries={view.entries}
      screenHref={doc.documents.length > 0 ? entry.routes[0] : undefined}
    />
  );
}
