import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';

/** The reply-window ring beside the buttons (see `window-timer.tsx`). */
const TIMER_SIZE = 44;
/** The avatar in the thread header and the gap that separates it from the name. */
export const HEADER_AVATAR_SIZE = 44;
/** A name narrower than this is cut to a few letters; below it the avatar makes way for the name. */
const MIN_NAME_WIDTH = 120;

/** What the header has to fit beside the person's name. */
export interface HeaderControls {
  /** The reply-window ring (shown when the channel has a window). */
  timer: boolean;
  /** Round 48 dp buttons on the right: call, resolve or reopen, the three dots. */
  buttons: number;
}

/**
 * Whether the thread header has room for the avatar. The back button, the ring and the buttons keep their size (a tap target is
 * never shrunk), so on a narrow phone with all of them the name would be left with a few dp and the status badge ran into the ring.
 * The name is worth more than a picture there, so the avatar steps aside until the name has room.
 */
export function headerShowsAvatar(width: number, controls: HeaderControls): boolean {
  const fixed =
    spacing.lg + // the bar's left padding
    spacing.xs + // and its right padding
    MIN_TOUCH_TARGET + // back
    spacing.sm + // gap after back
    (controls.timer ? TIMER_SIZE : 0) +
    controls.buttons * MIN_TOUCH_TARGET;
  const forName = width - fixed - HEADER_AVATAR_SIZE - spacing.sm;
  return forName >= MIN_NAME_WIDTH;
}
