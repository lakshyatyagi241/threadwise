/**
 * The inbox's keyboard shortcuts: `j` and `k` move down and up the list, `e` resolves (or reopens) the open conversation, `/`
 * jumps to the search box. They only fire when nothing that takes text has the focus and no modifier is held, so typing a reply
 * or a note never triggers one.
 */
export type ShortcutAction = 'next' | 'prev' | 'resolve' | 'search';

export function shortcutAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'j':
      return 'next';
    case 'k':
      return 'prev';
    case 'e':
      return 'resolve';
    case '/':
      return 'search';
    default:
      return null;
  }
}

/** Whether the focus is somewhere a letter is meant to be typed (or a control that uses the keys itself). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'file'].includes(type);
  }
  return false;
}
