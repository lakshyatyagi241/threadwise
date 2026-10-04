'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Input, Modal, cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { Crown } from '@/components/shell/top-nav';
import { useShellData } from '@/components/shell/shell-data';
import { demotedBarItems, resolveTopBar } from '@/components/shell/topbar-model';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useStoredValue } from '@/lib/use-stored-value';
import {
  DEFAULT_SHORTCUT_IDS,
  SHORTCUT_PRESETS,
  SHORTCUT_SUBTITLE_MAX,
  SHORTCUT_TITLE_MAX,
  SHORTCUT_URL_MAX,
  TOOL_CATEGORIES,
  addShortcut,
  filterCards,
  loadShortcuts,
  moveShortcut,
  normaliseHref,
  storageKey,
  toolCards,
  type Shortcut,
} from './more-model';

const NS = 'admin-console-shell.more';
const TIP_IDS = ['templates', 'flows', 'palette', 'scheduled', 'wallet'] as const;
const TIP_ROTATE_MS = 7000;

/**
 * The More hub (TW-ASHELL-020): the overflow page behind the top bar. It lists every screen this person can open that the bar
 * does not already hold, filtered by tab, with a Navigation strip for entries the admin took out of the bar, the plan and
 * balance, rotating tips and the browser-local shortcut strip. Live counters wait on each domain's stats provider.
 */
export function MorePage() {
  const t = useTranslations(NS);
  const tAll = useTranslations();
  const { nav, tiles, bar, walletLabel } = useShellData();
  const { org } = useSession();
  const [tab, setTab] = useState<(typeof TOOL_CATEGORIES)[number]>('all');

  const barHrefs = useMemo(
    () => new Set(resolveTopBar(bar, nav, tiles).map((b) => b.href)),
    [bar, nav, tiles],
  );
  const cards = useMemo(
    () => filterCards(toolCards(nav, tiles, barHrefs), tab),
    [nav, tiles, barHrefs, tab],
  );
  const demoted = useMemo(() => demotedBarItems(bar, nav, tiles), [bar, nav, tiles]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            {t('titleLead')} <span className="italic text-primary">{t('titleTail')}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      {demoted.length > 0 && (
        <div className="space-y-2" aria-label={t('navigation')} role="region">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('navigation')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {demoted.map((d) => (
              <li key={d.key}>
                <Link
                  href={d.href}
                  className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm font-medium outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {d.icon && <NavIcon name={d.icon} className="size-5 text-primary" />}
                  {d.labelKey ? tAll(d.labelKey) : null}
                  {d.locked && <Crown />}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('allTools')}
            </h2>
            <div role="tablist" aria-label={t('allTools')} className="flex gap-1">
              {TOOL_CATEGORIES.map((c) => (
                <button
                  key={c}
                  role="tab"
                  type="button"
                  aria-selected={tab === c}
                  onClick={() => setTab(c)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    tab === c
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {t(`tabs.${c}`)}
                </button>
              ))}
            </div>
          </div>
          {cards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('noTools')}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((c) => {
                const body = (
                  <>
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {c.icon && <NavIcon name={c.icon} className="size-4 text-primary" />}
                      {tAll(c.labelKey)}
                      {c.locked && <Crown />}
                    </span>
                    {c.descriptionKey && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {tAll(c.descriptionKey)}
                      </span>
                    )}
                  </>
                );
                const cls = 'flex h-full flex-col gap-1 rounded-xl border border-border p-4';
                // A crown card is not clickable (TW-ASHELL-020): the upgrade link is the plan card on the right.
                return (
                  <li key={c.id}>
                    {c.locked ? (
                      <div className={cn(cls, 'opacity-70')}>{body}</div>
                    ) : (
                      <Link
                        href={c.href}
                        className={cn(
                          cls,
                          'outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary',
                        )}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">{t('plan')}</h2>
            <div className="flex items-center justify-between">
              <Badge>{org.plan}</Badge>
              <Link href="/account/plans" className="text-sm text-primary hover:underline">
                {t('managePlan')}
              </Link>
            </div>
          </Card>
          {walletLabel && (
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t('wallet')}</h2>
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold tabular-nums">{walletLabel}</span>
                <Link
                  href="/billing/checkout/wallet"
                  className="text-sm text-primary hover:underline"
                >
                  {t('topUp')}
                </Link>
              </div>
            </Card>
          )}
          <TipCard />
        </aside>
      </div>

      <ShortcutStrip workspaceId={org.id} />
    </section>
  );
}

/** One tip at a time, changing every 7 seconds, with a dot pager (TW-ASHELL-020). */
function TipCard() {
  const t = useTranslations(`${NS}.tips`);
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % TIP_IDS.length), TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [i]);
  const tip = TIP_IDS[i]!;
  return (
    <Card className="space-y-2 p-4" aria-live="off">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="text-sm font-medium">{t(`${tip}.title`)}</p>
      <p className="text-xs text-muted-foreground">{t(`${tip}.body`)}</p>
      <div className="flex gap-1" role="group" aria-label={t('pager')}>
        {TIP_IDS.map((id, n) => (
          <button
            key={id}
            type="button"
            aria-label={t(`${id}.title`)}
            aria-current={n === i}
            onClick={() => setI(n)}
            className={cn('size-2 rounded-full', n === i ? 'bg-primary' : 'bg-border')}
          />
        ))}
      </div>
    </Card>
  );
}

/** TW-ASHELL-021: the shortcuts strip and its customiser, kept in this browser, one list per workspace. */
function ShortcutStrip({ workspaceId }: { workspaceId: string | number }) {
  const t = useTranslations(`${NS}.shortcuts`);
  const key = storageKey(workspaceId);
  const [raw, setRaw] = useStoredValue(key);
  const defaults = useMemo<Shortcut[]>(
    () =>
      DEFAULT_SHORTCUT_IDS.map((id) => ({
        id,
        title: t(`presets.${id}.title`),
        subtitle: t(`presets.${id}.subtitle`),
        href: SHORTCUT_PRESETS[id]!.href,
        icon: SHORTCUT_PRESETS[id]!.icon,
      })),
    [t],
  );
  const list = useMemo(() => loadShortcuts(raw, defaults), [raw, defaults]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Shortcut[]>([]);
  const [custom, setCustom] = useState({ title: '', subtitle: '', href: '' });
  const [problem, setProblem] = useState(false);

  const open = () => {
    setDraft(list);
    setCustom({ title: '', subtitle: '', href: '' });
    setProblem(false);
    setEditing(true);
  };
  const addPreset = (id: string) => {
    const p = SHORTCUT_PRESETS[id];
    if (!p) return;
    const next = addShortcut(draft, {
      id,
      title: t(`presets.${id}.title`),
      subtitle: t(`presets.${id}.subtitle`),
      href: p.href,
      icon: p.icon,
    });
    if (next) setDraft(next);
  };

  return (
    <section aria-labelledby="shortcuts-title" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="shortcuts-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Button variant="secondary" size="sm" onClick={open}>
          {t('customise')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className="flex h-full flex-col gap-1 rounded-xl border border-border p-3 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <NavIcon name={s.icon} className="size-4 text-primary" />
                  {s.title}
                </span>
                {s.subtitle && <span className="text-xs text-muted-foreground">{s.subtitle}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={t('editTitle')} size="lg">
        <div className="space-y-4">
          <ul className="space-y-1">
            {draft.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
              >
                <span className="truncate">{s.title}</span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('up', { item: s.title })}
                    onClick={() => setDraft(moveShortcut(draft, s.id, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('down', { item: s.title })}
                    onClick={() => setDraft(moveShortcut(draft, s.id, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('remove', { item: s.title })}
                    onClick={() => setDraft(draft.filter((x) => x.id !== s.id))}
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
            {draft.length === 0 && (
              <li className="text-sm text-muted-foreground">{t('emptyEditor')}</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SHORTCUT_PRESETS)
              .filter((id) => !draft.some((d) => d.id === id))
              .map((id) => (
                <Button key={id} size="sm" variant="secondary" onClick={() => addPreset(id)}>
                  + {t(`presets.${id}.title`)}
                </Button>
              ))}
          </div>
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const next = addShortcut(draft, {
                id: `custom-${Date.now()}`,
                title: custom.title,
                subtitle: custom.subtitle,
                href: custom.href,
                icon: 'link',
                custom: true,
              });
              if (!next) return setProblem(true);
              setProblem(false);
              setDraft(next);
              setCustom({ title: '', subtitle: '', href: '' });
            }}
          >
            <Input
              aria-label={t('customTitle')}
              placeholder={t('customTitle')}
              maxLength={SHORTCUT_TITLE_MAX}
              value={custom.title}
              onChange={(e) => setCustom({ ...custom, title: e.target.value })}
            />
            <Input
              aria-label={t('customSubtitle')}
              placeholder={t('customSubtitle')}
              maxLength={SHORTCUT_SUBTITLE_MAX}
              value={custom.subtitle}
              onChange={(e) => setCustom({ ...custom, subtitle: e.target.value })}
            />
            <Input
              aria-label={t('customUrl')}
              placeholder="/page"
              dir="ltr"
              maxLength={SHORTCUT_URL_MAX}
              value={custom.href}
              onChange={(e) => setCustom({ ...custom, href: e.target.value })}
            />
            {problem && <p className="text-xs text-danger sm:col-span-3">{t('customProblem')}</p>}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="sm:col-span-3 sm:justify-self-start"
            >
              {t('addCustom')}
            </Button>
          </form>
          <div className="flex justify-between border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setDraft(defaults)}>
              {t('reset')}
            </Button>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setRaw(JSON.stringify(draft.map((s) => ({ ...s, href: normaliseHref(s.href) }))));
                  setEditing(false);
                }}
              >
                {t('save')}
              </Button>
            </span>
          </div>
        </div>
      </Modal>
    </section>
  );
}
