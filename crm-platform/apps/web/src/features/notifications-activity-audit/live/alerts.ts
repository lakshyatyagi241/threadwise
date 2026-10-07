import { PING_MIN_GAP_MS, formatTitle } from './model';

/**
 * The browser side of an alert: the ping, the desktop notification, the tab title, and the two per-browser switches. Every call is
 * defensive (private windows, blocked storage, no `Notification`, autoplay rules): a failure means "no sound" or "no alert", never
 * an error on the page.
 */

export const SOUND_KEY = 'crm.notify.sound';
export const DESKTOP_KEY = 'crm.notify.desktop';

// --- the two switches (this browser only) -----------------------------------------------------------------------------------

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Sound is on unless the person turned it off. */
export function soundEnabled(): boolean {
  return readKey(SOUND_KEY) !== 'off';
}

export type DesktopSupport = 'unsupported' | 'default' | 'granted' | 'denied';

export function desktopPermission(): DesktopSupport {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/** Desktop alerts happen only with the browser's permission and while the person has not switched them off. */
export function desktopEnabled(): boolean {
  return desktopPermission() === 'granted' && readKey(DESKTOP_KEY) !== 'off';
}

/**
 * Asks the browser for permission. Only ever called from the click on "Enable desktop alerts", never on page load or on the first
 * click anywhere. Returns the answer.
 */
export async function requestDesktopPermission(): Promise<DesktopSupport> {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    const answer = await Notification.requestPermission();
    return answer;
  } catch {
    return desktopPermission();
  }
}

// --- the ping ---------------------------------------------------------------------------------------------------------------

/** WaDesk's two tones: 880 Hz then 1175 Hz, about a third of a second in all. */
const TONES: ReadonlyArray<{ hz: number; at: number; length: number }> = [
  { hz: 880, at: 0, length: 0.16 },
  { hz: 1175, at: 0.17, length: 0.17 },
];

type AudioContextCtor = typeof AudioContext;

export interface Pinger {
  /** Plays the ping if a gesture has unlocked audio and the last one was not too recent. Returns whether it tried. */
  ping(): boolean;
  /** Starts listening for the first gesture (a click or a key press), after which sound may play. Returns the cleanup. */
  armOnGesture(target?: Document): () => void;
  readonly unlocked: boolean;
}

export function createPinger(now: () => number = Date.now): Pinger {
  let ctx: AudioContext | null = null;
  let unlocked = false;
  let lastAt = -Infinity;

  const unlock = () => {
    unlocked = true;
    try {
      const Ctor: AudioContextCtor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (Ctor && !ctx) ctx = new Ctor();
      void ctx?.resume();
    } catch {
      /* no audio */
    }
  };

  return {
    get unlocked() {
      return unlocked;
    },
    armOnGesture(target = document) {
      if (unlocked) return () => undefined;
      const handler = () => {
        unlock();
        remove();
      };
      const remove = () => {
        target.removeEventListener('pointerdown', handler);
        target.removeEventListener('keydown', handler);
      };
      target.addEventListener('pointerdown', handler, { once: true });
      target.addEventListener('keydown', handler, { once: true });
      return remove;
    },
    ping() {
      if (!unlocked || !ctx) return false;
      const t = now();
      if (t - lastAt < PING_MIN_GAP_MS) return false;
      lastAt = t;
      try {
        void ctx.resume();
        const start = ctx.currentTime + 0.01;
        for (const tone of TONES) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = tone.hz;
          gain.gain.setValueAtTime(0.0001, start + tone.at);
          gain.gain.exponentialRampToValueAtTime(0.15, start + tone.at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.length);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start + tone.at);
          osc.stop(start + tone.at + tone.length + 0.02);
        }
      } catch {
        /* a blocked or closed audio context is silence, not an error */
      }
      return true;
    },
  };
}

// --- desktop alert ----------------------------------------------------------------------------------------------------------

export interface DesktopAlertInput {
  title: string;
  body: string;
  /** A chat replaces its own earlier alert instead of stacking. */
  tag: string;
  onClick: () => void;
}

/** Shows the alert if the browser allows it. Never throws. */
export function showDesktopAlert(input: DesktopAlertInput): void {
  try {
    if (desktopPermission() !== 'granted') return;
    const n = new Notification(input.title, { body: input.body, tag: input.tag });
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch {
        /* ignore */
      }
      input.onClick();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

// --- tab title --------------------------------------------------------------------------------------------------------------

export interface TitleBadge {
  set(unread: number): void;
  dispose(): void;
}

/**
 * Keeps `(3) ` in front of the page title. Next rewrites the title on every navigation, so the title is watched and the badge put
 * back; setting it ourselves triggers the watcher once more, which finds nothing to change and stops.
 */
export function createTitleBadge(doc: Document = document): TitleBadge {
  let unread = 0;
  const apply = () => {
    const next = formatTitle(doc.title, unread);
    if (doc.title !== next) doc.title = next;
  };
  let observer: MutationObserver | null = null;
  try {
    observer = new MutationObserver(apply);
    observer.observe(doc.head ?? doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  } catch {
    observer = null;
  }
  return {
    set(n) {
      unread = Math.max(0, n);
      apply();
    },
    dispose() {
      observer?.disconnect();
      unread = 0;
      try {
        const base = formatTitle(doc.title, 0);
        if (doc.title !== base) doc.title = base;
      } catch {
        /* ignore */
      }
    },
  };
}
