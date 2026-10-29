'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

/** True when the visitor asked their system for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

export interface PlayLine {
  from: string;
}

interface PlayState {
  key: unknown;
  count: number;
  typing: boolean;
}

/**
 * Plays a conversation one message at a time: a reply from the business shows the typing dots first. It starts again from
 * nothing whenever `key` changes, waits `hold` ms on the finished chat and then calls `onEnd`. With `run` false it stays
 * where it is, and for visitors who prefer reduced motion the whole chat is shown at once.
 */
export function useChatPlayback(
  lines: ReadonlyArray<PlayLine>,
  run: boolean,
  key: unknown,
  onEnd?: () => void,
  hold = 3800,
  showTyping = true,
): { count: number; typing: boolean; done: boolean } {
  const reduced = useReducedMotion();
  const [state, setState] = useState<PlayState>({ key, count: 0, typing: false });
  const end = useRef(onEnd);
  useEffect(() => {
    end.current = onEnd;
  });

  useEffect(() => {
    if (!run || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let i = 0;
    const step = () => {
      if (i >= lines.length) {
        timers.push(setTimeout(() => end.current?.(), hold));
        return;
      }
      if (showTyping && lines[i]!.from === 'business') {
        setState({ key, count: i, typing: true });
        timers.push(
          setTimeout(() => {
            i += 1;
            setState({ key, count: i, typing: false });
            timers.push(setTimeout(step, 900));
          }, 1000),
        );
      } else {
        i += 1;
        setState({ key, count: i, typing: false });
        timers.push(setTimeout(step, 1100));
      }
    };
    timers.push(setTimeout(step, 500));
    return () => timers.forEach(clearTimeout);
  }, [run, reduced, key, lines, hold, showTyping]);

  if (reduced) return { count: lines.length, typing: false, done: true };
  const cur = state.key === key ? state : { count: 0, typing: false };
  return { count: cur.count, typing: cur.typing, done: cur.count >= lines.length };
}
