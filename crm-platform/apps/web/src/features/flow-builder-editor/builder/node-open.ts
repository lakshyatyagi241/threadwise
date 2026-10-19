/**
 * A double-click on a node card opens that node in the inspector. Controls inside the card keep their own double-click
 * (selecting a word in a prompt box, a button, a connection dot), so only a double-click on the card itself counts.
 */
const OWN_DOUBLE_CLICK =
  'input, textarea, select, button, a, label, [contenteditable], [data-port], [role="button"]';

export function opensNodeOnDoubleClick(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return true;
  return (target as Element).closest(OWN_DOUBLE_CLICK) === null;
}

/**
 * Enter on a selected node opens it in the inspector too. A focused button or link keeps its own Enter (the toolbar's Delete must
 * not be taken for "open").
 */
export function opensNodeOnEnter(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return true;
  return (target as Element).closest('button, a, [role="button"], [data-port]') === null;
}
