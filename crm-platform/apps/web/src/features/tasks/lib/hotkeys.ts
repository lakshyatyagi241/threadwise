/** Keyboard shortcuts of the Tasks hub. Pure, so the mapping can be tested without a browser. */
export type HotkeyAction =
  | 'next'
  | 'prev'
  | 'open'
  | 'toggleComplete'
  | 'toggleSelect'
  | 'newTask'
  | 'focusSearch'
  | 'clearSelection'
  | 'help';

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** `tagName` of the focused element, whether it is editable, and whether a dialog or menu is open around it. */
  targetTag?: string;
  targetEditable?: boolean;
  inDialog?: boolean;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

/**
 * What a key press means on the list, or null when it is not ours (typing in a field, focus on a button or link where
 * Enter must keep its own meaning, a dialog open, a modifier held).
 */
export function hotkeyAction(e: KeyLike): HotkeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.inDialog) return null;
  const tag = e.targetTag?.toUpperCase();
  if (e.targetEditable) return null;
  if (tag && TYPING.has(tag)) {
    // A button or link keeps Enter for itself; the letters still work from there.
    if (tag === 'BUTTON' || tag === 'A') {
      if (e.key === 'Enter' || e.key === ' ') return null;
    } else return null;
  }
  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'prev';
    case 'Enter':
      return 'open';
    case 'e':
      return 'toggleComplete';
    case 'x':
      return 'toggleSelect';
    case 'n':
      return 'newTask';
    case '/':
      return 'focusSearch';
    case 'Escape':
      return 'clearSelection';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** Moves the active row, staying inside the loaded rows. -1 means "none yet": the first move lands on an end. */
export function moveActive(current: number, count: number, dir: 'next' | 'prev'): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 'next' ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (dir === 'next' ? 1 : -1)));
}
