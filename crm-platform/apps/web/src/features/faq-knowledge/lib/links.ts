/**
 * Where the FAQ screens live: the Simple builder of a flow, on its FAQs tab. The screen inside the tab is `?view=`: a name for
 * the fixed screens, or the FAQ's own id to edit it. Nothing else is stored in the address, so a reload or the browser's back
 * button lands on the same screen.
 */
export type FaqView = 'list' | 'new' | 'test' | 'unanswered' | 'insights' | 'settings';

/** The strip of the panel: the list, the editor and "new" all belong to its first tab. */
export type FaqTabId = 'faqs' | 'test' | 'unanswered' | 'insights' | 'settings';

export type FaqLocation = { view: FaqView } | { view: 'edit'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMED: readonly FaqView[] = ['list', 'new', 'test', 'unanswered', 'insights', 'settings'];

/** What `?view=` asks for; a missing, unknown or malformed value opens the list. */
export function parseFaqLocation(view: string | null): FaqLocation {
  if (view && UUID.test(view)) return { view: 'edit', id: view };
  const named = NAMED.find((n) => n === view);
  return { view: named ?? 'list' };
}

/** The panel tab a location belongs to. */
export function faqTabOf(loc: FaqLocation): FaqTabId {
  return loc.view === 'edit' || loc.view === 'new' || loc.view === 'list' ? 'faqs' : loc.view;
}

/**
 * `/flows/simple/<flow>?tab=faqs&view=...`: the link to one screen of a flow's FAQs. The list is the tab's own page, so it has no
 * `view`.
 */
export function faqHref(flowId: string, target: FaqView | { faqId: string } = 'list'): string {
  const base = `/flows/simple/${encodeURIComponent(flowId)}?tab=faqs`;
  if (target === 'list') return base;
  const view = typeof target === 'string' ? target : target.faqId;
  return `${base}&view=${encodeURIComponent(view)}`;
}
