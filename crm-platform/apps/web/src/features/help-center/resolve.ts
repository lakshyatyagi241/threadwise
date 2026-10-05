import { evaluateGates } from '@/features/_registry/resolve';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { Capabilities, ResolvedNavItem } from '@/features/_registry/types';
import { HELP_AREAS, type HelpDoc, type HelpIndexEntry, type HelpLocaleText } from './types';

type Screen = ResolvedNavItem | ResolvedSettingsTile;

/**
 * The documented screens the person can open. The menu and the Settings tiles arrive already resolved, so a screen the person's
 * permission or channel removed is simply absent, a screen the plan lacks is `locked`, and a screen that is only planned is
 * `comingSoon`: none of those count as available, which is how a doc inherits its screen's gates without repeating them.
 */
function availableScreens(
  doc: HelpDoc,
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
): Screen[] {
  const out: Screen[] = [];
  for (const ref of doc.documents) {
    const at = ref.indexOf(':');
    const kind = ref.slice(0, at);
    const id = ref.slice(at + 1);
    const found: Screen | undefined =
      kind === 'nav' ? nav.find((n) => n.id === id) : tiles.find((t) => t.id === id);
    if (found && !found.comingSoon && !found.locked) out.push(found);
  }
  return out;
}

const compareDocs = (a: HelpDoc, b: HelpDoc): number =>
  HELP_AREAS.indexOf(a.area) - HELP_AREAS.indexOf(b.area) ||
  a.order - b.order ||
  a.id.localeCompare(b.id);

/**
 * The docs this person may see, in `/help` order. A doc is visible when its audience is the workspace, at least one screen it
 * documents is available (a guide that documents none always passes this step), and its own gates pass. Unlike the menu, a
 * missing plan feature removes the doc instead of locking it: Help must not advertise what the plan lacks. Unknown
 * capabilities (`null`) remove nothing, the same fail-open rule the menu uses.
 */
export function resolveHelp(
  docs: readonly HelpDoc[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  caps: Capabilities,
): HelpDoc[] {
  return docs
    .filter((doc) => {
      if (doc.audience !== 'workspace') return false;
      if (doc.documents.length > 0 && availableScreens(doc, nav, tiles).length === 0) return false;
      const gate = evaluateGates(doc.gates, caps);
      return gate !== null && !gate.locked;
    })
    .sort(compareDocs);
}

/** The doc's text in the person's language; English, flagged as a fallback, when there is no translation. */
export function localized(doc: HelpDoc, locale: string): HelpLocaleText & { fallback: boolean } {
  const own = doc.text[locale];
  if (own) return { ...own, fallback: false };
  return { ...doc.text['en']!, fallback: locale !== 'en' };
}

/** What the client gets of the visible docs: no bodies, in the person's language. */
export function toIndex(
  docs: readonly HelpDoc[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  locale: string,
): HelpIndexEntry[] {
  return docs.map((doc) => {
    const text = localized(doc, locale);
    const routes = [
      ...new Set([...availableScreens(doc, nav, tiles).map((s) => s.href), ...doc.routes]),
    ];
    return {
      id: doc.id,
      area: doc.area,
      order: doc.order,
      title: text.title,
      summary: text.summary,
      keywords: doc.keywords,
      routes,
      headings: text.blocks.flatMap((b) =>
        b.t === 'h' ? [{ id: b.id, text: b.text, level: b.level }] : [],
      ),
      fallback: text.fallback,
    };
  });
}

export interface VisibleHelp {
  docs: HelpDoc[];
  entries: HelpIndexEntry[];
}

export function visibleHelp(
  docs: readonly HelpDoc[],
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
  caps: Capabilities,
  locale: string,
): VisibleHelp {
  const visible = resolveHelp(docs, nav, tiles, caps);
  return { docs: visible, entries: toIndex(visible, nav, tiles, locale) };
}
