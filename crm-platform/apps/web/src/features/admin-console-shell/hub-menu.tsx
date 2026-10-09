'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import {
  CONSOLE_HOME,
  activeStatusBadgeInfo,
  formatCount,
  hubHref,
  isGroup,
  pageRuns,
  type ConsoleEntry,
  type ConsoleGroup,
  type ConsoleLeaf,
} from './console-nav';
import type { ConsoleCounts } from './console-counts';
import { RailLink } from './rail-link';

/**
 * Every area as a rail link, Home first. This is the whole menu away from an area (the account page, a page outside the menu,
 * the phone drawer on Home) and, inside an area, the icon-only rail when it is collapsed.
 */
export function AreaLinks({
  entries,
  activeHubId,
  homeActive,
  gated,
  skip,
}: {
  entries: readonly ConsoleEntry[];
  activeHubId: string | null;
  homeActive: boolean;
  gated: boolean;
  /** An area to leave out (the one the switcher is already showing). */
  skip?: string;
}) {
  const t = useTranslations();
  const home = entries.find((e): e is ConsoleLeaf => !isGroup(e));
  return (
    <>
      {home && !skip && (
        <RailLink
          href={CONSOLE_HOME}
          icon="dashboard"
          label={home.label ?? t(home.labelKey)}
          active={homeActive}
          disabled={gated}
          testId="hub-home"
        />
      )}
      {entries
        .filter(isGroup)
        .map((hub) =>
          hub.id === skip ? null : (
            <RailLink
              key={hub.id}
              href={hubHref(hub)}
              icon={hub.icon ?? 'dashboard'}
              label={t(hub.labelKey)}
              active={hub.id === activeHubId}
              disabled={gated}
              testId={`hub-${hub.id}`}
            />
          ),
        )}
    </>
  );
}

function PageLink({
  leaf,
  active,
  counts,
  gated,
}: {
  leaf: ConsoleLeaf;
  active: boolean;
  counts: ConsoleCounts;
  gated: boolean;
}) {
  const t = useTranslations();
  const label = leaf.label ?? t(leaf.labelKey);
  const count = formatCount(leaf.badgeKey ? counts[leaf.badgeKey] : null);
  const status = activeStatusBadgeInfo(leaf, counts);
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count && (
        <span
          data-testid={`count-${leaf.id}`}
          className="rounded-full bg-white/15 px-1.5 text-xs tabular-nums"
        >
          {count}
        </span>
      )}
      {status && (
        <span
          data-testid={`status-${leaf.id}`}
          data-tone={status.tone}
          className={cn(
            'rounded-full px-1.5 text-[0.6875rem] font-medium leading-4',
            status.tone === 'warning' ? 'bg-warning/25' : 'bg-white/15',
          )}
        >
          {t(status.labelKey)}
        </span>
      )}
    </>
  );
  const cls = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm';
  if (gated) {
    return (
      <span aria-disabled="true" className={cn(cls, 'opacity-40')}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={leaf.href}
      title={label}
      data-testid={`menu-${leaf.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        cls,
        'hover:bg-sidebar-active focus-visible:ring-2 focus-visible:ring-primary',
        active && 'bg-sidebar-active text-white',
      )}
    >
      {body}
    </Link>
  );
}

/**
 * The menu on the left once an area is open (docs/specs/admin-menu-hubs.md): a way back to all areas, the area's name with a
 * switcher to its neighbours, then the area's pages under small group headings. Every page is a link to its own address, so
 * bookmarks, permissions and each page's own code are untouched; the shell draws this beside whatever page is open.
 */
export function HubMenu({
  hub,
  entries,
  activeId,
  counts,
  gated,
}: {
  hub: ConsoleGroup;
  entries: readonly ConsoleEntry[];
  activeId: string | null;
  counts: ConsoleCounts;
  gated: boolean;
}) {
  const t = useTranslations();
  const home = entries.find((e): e is ConsoleLeaf => !isGroup(e));
  return (
    <div data-testid="hub-menu" className="space-y-0.5">
      {home && (
        <RailLink
          href={CONSOLE_HOME}
          icon="dashboard"
          label={home.label ?? t(home.labelKey)}
          active={false}
          disabled={gated}
          testId="hub-home"
        />
      )}
      {entries.filter(isGroup).map((area) => (
        <div key={area.id} className="space-y-0.5">
          <RailLink
            href={hubHref(area)}
            icon={area.icon ?? 'dashboard'}
            label={t(area.labelKey)}
            active={area.id === hub.id}
            disabled={gated}
            testId={`hub-${area.id}`}
          />
          {area.id === hub.id && (
            <div data-testid="hub-pages" className="ms-4 space-y-0.5 border-s border-white/10 ps-2">
              {pageRuns(hub).map((run, i) => (
                <div key={run.captionKey ?? `run-${i}`} className="space-y-0.5">
                  {run.captionKey && (
                    <div className="px-2 pb-0.5 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider opacity-60">
                      {t(run.captionKey)}
                    </div>
                  )}
                  {run.pages.map((leaf) => (
                    <PageLink
                      key={leaf.id}
                      leaf={leaf}
                      active={leaf.id === activeId}
                      counts={counts}
                      gated={gated}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
