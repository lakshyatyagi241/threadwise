import type { ShopProduct } from '../../../graph/commerce-shapes';

/** Pure rules of the Commerce shop node (WD-FLR-041). */

/** One product's card: the name, the price when it has one, and how to pick it. */
export function productCaption(n: number, p: ShopProduct): string {
  const lines = [`*${n}. ${p.name || p.retailerId}*`];
  if (p.priceMinor) lines.push(`${p.currency} ${(p.priceMinor / 100).toFixed(2)}`.trim());
  lines.push(`_Reply '${n}' to buy this one._`);
  return lines.join('\n');
}

/** The line that asks which one: every name again, so the customer need not scroll back to the cards. */
export function pickPrompt(products: ShopProduct[], footer: string): string {
  const lines = [
    'Reply with the number of the product you want to buy:',
    products.map((p, i) => `  ${i + 1}. ${p.name || p.retailerId}`).join('\n'),
  ];
  if (footer) lines.push(`_${footer}_`);
  return lines.join('\n');
}

/** The cards' lead-in: the header in bold, then the body; nothing at all when the author wrote neither. */
export function preamble(header: string, body: string): string {
  const lines: string[] = [];
  if (header) lines.push(`*${header}*`);
  if (body) lines.push(body);
  return lines.join('\n\n');
}

/**
 * Which product a typed reply means (WD-FLR-041 rule 4): its number, else the first whose name contains the text. -1 when none.
 * A number must be a number, not the start of a word ("2 pizzas" is 2, as WaDesk's parseInt read it).
 */
export function pickIndex(text: string, products: ShopProduct[]): number {
  const n = parseInt(text, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= products.length) return n - 1;
  const lc = text.toLowerCase();
  if (lc === '') return -1;
  return products.findIndex((p) => p.name.toLowerCase().includes(lc));
}
