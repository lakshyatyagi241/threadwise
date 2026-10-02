import { NAV_LAYOUT_LOCKED_KEY, normalizeNavBar, type NavLayoutKey } from '@crm/contracts';

/** Moves one bar entry up or down; the locked "More" entry never moves and nothing passes it. */
export function moveInBar(
  bar: readonly NavLayoutKey[],
  key: NavLayoutKey,
  dir: -1 | 1,
): NavLayoutKey[] {
  const i = bar.indexOf(key);
  const j = i + dir;
  if (key === NAV_LAYOUT_LOCKED_KEY || i < 0 || j < 0 || j >= bar.length) return [...bar];
  if (bar[j] === NAV_LAYOUT_LOCKED_KEY) return [...bar];
  const next = [...bar];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Adds a More-zone entry just before the locked entry. */
export function addToBar(bar: readonly NavLayoutKey[], key: NavLayoutKey): NavLayoutKey[] {
  const without = bar.filter((k) => k !== key && k !== NAV_LAYOUT_LOCKED_KEY);
  return normalizeNavBar([...without, key, NAV_LAYOUT_LOCKED_KEY]);
}

export function removeFromBar(bar: readonly NavLayoutKey[], key: NavLayoutKey): NavLayoutKey[] {
  if (key === NAV_LAYOUT_LOCKED_KEY) return [...bar];
  return bar.filter((k) => k !== key);
}
