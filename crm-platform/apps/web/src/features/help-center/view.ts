import { HELP_DOCS } from '@/features/_registry/help.generated';
import { NAV } from '@/features/_registry/nav.generated';
import { PLANNED_NAV } from '@/features/_registry/planned';
import { resolveNavAll } from '@/features/_registry/resolve';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import { SETTINGS } from '@/features/_registry/settings.generated';
import type { Capabilities } from '@/features/_registry/types';
import { visibleHelp, type VisibleHelp } from './resolve';
import type { HelpDoc } from './types';

/**
 * The docs a person may see and their client index, from the same registries and gates that shape the menu. `resolveNavAll`
 * (not `resolveNav`) because the account hub's panes are screens a doc may document even though the sidebar leaves them out.
 * The app layout and the `/help` pages both call this, so they can never disagree about what is visible.
 */
export function helpFor(
  caps: Capabilities,
  locale: string,
  docs: readonly HelpDoc[] = HELP_DOCS,
): VisibleHelp {
  const nav = resolveNavAll(NAV, caps, { planned: PLANNED_NAV });
  const tiles = resolveSettings(SETTINGS, caps, { planned: PLANNED_SETTINGS });
  return visibleHelp(docs, nav, tiles, caps, locale);
}
