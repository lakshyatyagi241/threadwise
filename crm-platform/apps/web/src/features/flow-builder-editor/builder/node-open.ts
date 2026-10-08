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
