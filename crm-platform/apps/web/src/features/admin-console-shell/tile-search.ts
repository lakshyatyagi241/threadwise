/**
 * WD-ASHELL-008: the settings hub's search box. A tile stays when every word typed appears, in any order and in any case, in
 * its title, description or tags (WaDesk matched the tile's whole text). A blank box keeps every tile.
 */
export function tileMatches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}
