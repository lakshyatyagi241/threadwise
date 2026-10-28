'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInView } from './use-in-view';
import { AppMock, type MockState } from './mocks';
import './explainer.css';

const TICK_MS = 750;
const TICKS = 7;

interface Frame {
  state: MockState;
  /** The `data-t` name the cursor moves to; null leaves it where it is. */
  target: string | null;
  click?: boolean;
}

interface Scene {
  screen: string;
  title: string;
  text: string;
  frame: (t: number) => Frame;
}

/**
 * One lead's story, told on the drawn app screens. Each scene is a function of the tick (0 to 6): it returns what the
 * screen shows and where the cursor goes. Nothing here is real data.
 */
const SCENES: Scene[] = [
  {
    screen: 'inbox',
    title: 'A customer messages you',
    text: 'On WhatsApp, web chat or Instagram, at any hour. It lands in the shared inbox.',
    frame: (t) => ({
      state: { newConv: t >= 1 ? 1 : 0, open: t >= 4 ? 1 : 0, msgs: 1, owner: 0, qual: 0 },
      target: t >= 1 ? 'conv-new' : null,
      click: t === 4,
    }),
  },
  {
    screen: 'inbox',
    title: 'The AI agent answers and qualifies',
    text: 'It replies from your own content, asks the right questions and saves the answers.',
    frame: (t) => ({
      state: {
        newConv: 1,
        open: 1,
        msgs: [1, 1, 2, 3, 3, 4, 4][t],
        typing: t === 1 || t === 4 ? 1 : 0,
        owner: 0,
        qual: t >= 6 ? 1 : 0,
      },
      target: 'thread',
    }),
  },
  {
    screen: 'inbox',
    title: 'Your team takes over',
    text: 'Routing assigns the chat, and your team replies with the whole history in view.',
    frame: (t) => ({
      state: {
        newConv: 1,
        open: 1,
        msgs: t < 3 ? 4 : t < 5 ? 5 : 6,
        typing: t === 2 ? 1 : 0,
        owner: t >= 1 ? 1 : 0,
        qual: 1,
      },
      target: t < 2 ? 'owner' : 'thread',
      click: t === 1,
    }),
  },
  {
    screen: 'contacts',
    title: 'The CRM updates itself',
    text: 'The contact, stage, tags and follow-up task are saved without anyone typing them.',
    frame: (t) => ({
      state: { row: 1, detail: t >= 3 ? 1 : 0, fields: Math.max(0, t - 2) },
      target: t < 3 ? 'row-new' : 'detail',
      click: t === 3,
    }),
  },
  {
    screen: 'deals',
    title: 'Move the deal forward',
    text: 'Deals sit on a board beside the conversation, so every next step is owned and dated.',
    frame: (t) => ({
      state: { moved: t < 2 ? 0 : t < 4 ? 1 : 2 },
      target: t < 4 ? 'deal-card' : 'col-proposal',
      click: t === 2,
    }),
  },
  {
    screen: 'broadcasts',
    title: 'Campaigns bring them back',
    text: 'Reminders and offers go to the right segment on WhatsApp, and you see who read them.',
    frame: (t) => ({
      state: { send: t < 3 ? 0 : t < 5 ? 1 : 2 },
      target: 'send-btn',
      click: t === 3,
    }),
  },
];

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

/**
 * The home page walkthrough: about 30 seconds on the drawn app screens with a moving cursor, captions and controls. It
 * plays on its own, can be paused or stepped, and starts paused for visitors who prefer reduced motion.
 */
export function Explainer() {
  const [pos, setPos] = useState({ scene: 0, tick: 0 });
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  // It plays only while it is in view, and every time it comes into view it starts again from the first step.
  const playing = (choice ?? !reduced) && inView;
  useEffect(() => {
    if (inView) setPos({ scene: 0, tick: 0 });
  }, [inView]);

  const stage = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPos((p) =>
        p.tick + 1 >= TICKS
          ? { scene: (p.scene + 1) % SCENES.length, tick: 0 }
          : { scene: p.scene, tick: p.tick + 1 },
      );
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  const scene = SCENES[pos.scene]!;
  const frame = scene.frame(pos.tick);

  // Move the cursor to its target and show a click ripple. This reads the page after it has drawn, so it needs no state.
  useEffect(() => {
    const host = stage.current;
    const cur = cursor.current;
    if (!host || !cur) return;
    if (frame.target) {
      const el = host.querySelector<HTMLElement>(`[data-t="${frame.target}"]`);
      if (el) {
        const h = host.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const x = r.left - h.left + Math.min(r.width * 0.45, 140);
        const y = r.top - h.top + Math.min(r.height * 0.5, 60);
        cur.style.transform = `translate(${x}px, ${y}px)`;
        cur.style.opacity = '1';
      }
    }
    if (frame.click) {
      cur.classList.remove('click');
      void cur.offsetWidth;
      cur.classList.add('click');
    }
  }, [pos.scene, pos.tick, frame.target, frame.click]);

  return (
    <div ref={root} className="vx" role="group" aria-label="The customer journey, step by step">
      <ol className="vx-steps">
        {SCENES.map((x, n) => (
          <li key={x.title} className={n === pos.scene ? 'on' : ''}>
            <button
              type="button"
              aria-current={n === pos.scene ? 'step' : undefined}
              onClick={() => {
                setPos({ scene: n, tick: 0 });
                setChoice(false);
              }}
            >
              <span className="vx-n">{n + 1}</span>
              <span>
                <b>{x.title}</b>
                <i>{x.text}</i>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="vx-main">
        <div className="gx-shotframe vx-frame">
          <div className="gx-shotbar" aria-hidden>
            <i style={{ background: '#ff5f57' }} />
            <i style={{ background: '#febc2e' }} />
            <i style={{ background: '#28c840' }} />
          </div>
          <div className="vx-stage" ref={stage} aria-hidden>
            <AppMock id={scene.screen} state={frame.state} />
            <span className="vx-cursor" ref={cursor}>
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path
                  d="M4 3l15 7.5-6.4 1.9L10.7 19z"
                  fill="#fff"
                  stroke="#14162b"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <i />
            </span>
            <span className="vx-sample">Illustrative</span>
          </div>
        </div>
        <div className="vx-ctl">
          <button
            type="button"
            className="vx-play"
            aria-pressed={!playing}
            aria-label={playing ? 'Pause walkthrough' : 'Play walkthrough'}
            onClick={() => setChoice(!playing)}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="vx-prog" aria-hidden>
            <s
              key={`${pos.scene}-${playing}`}
              style={{
                animationDuration: `${TICK_MS * TICKS}ms`,
                animationPlayState: playing ? 'running' : 'paused',
              }}
            />
          </div>
          <span className="vx-count" aria-live="polite">
            {pos.scene + 1} / {SCENES.length}
          </span>
        </div>
      </div>
    </div>
  );
}
