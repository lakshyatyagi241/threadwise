'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NICHES } from './data/niches';
import { NICHE_EVENT } from './hero-rotator';
import { Icon } from './icons';
import { Portrait, type PortraitLook } from './portrait';
import './adaptive.css';

const PORTRAIT_LOOKS: PortraitLook[] = ['bun', 'crop', 'sweep', 'curl'];

/** Where the six small cards sit around the centre card on a wide screen, as a percentage of the artwork. */
const SPOTS: Array<[number, number]> = [
  [17, 19],
  [83, 19],
  [15, 50],
  [85, 50],
  [18, 81],
  [82, 81],
];

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const STEP_MS = 900;
const HOLD_MS = 4200;
const LAST = SPOTS.length + 1;

interface Link {
  d: string;
  from: [number, number];
  to: [number, number];
}

/**
 * One contact in the middle with the modules around it, joined by smooth connectors like a workflow canvas. The story plays
 * in order: the enquiry arrives, then each card lights up as its line is drawn, numbered 1 to 6, while the contact card says
 * what just happened. At the end a green "handled" badge shows and small signals keep travelling along the lines. The
 * industry is named on the card ("Clinic", "School", ...) with the word that business uses for its people, and tabs under the
 * artwork let a visitor pick theirs. On a phone the cards stack under the contact. Made-up data.
 */
export function HeroArt() {
  const [seq, setSeq] = useState({ i: 0, step: 0, run: 0 });
  const [manual, setManual] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
  const [links, setLinks] = useState<Link[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const centre = useRef<HTMLDivElement>(null);
  const cards = useRef<Array<HTMLDivElement | null>>([]);
  const { i, run } = seq;
  const step = reduced ? LAST : seq.step;
  const n = NICHES[i]!;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(NICHE_EVENT, { detail: i }));
  }, [i]);

  // Plays the steps one by one, holds the finished picture, then moves to the next industry unless the visitor chose one.
  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    let s = 0;
    const tick = () => {
      s += 1;
      setSeq((c) => ({ ...c, step: s }));
      if (s < LAST) timer = setTimeout(tick, STEP_MS);
      else if (!manual)
        timer = setTimeout(
          () => setSeq((c) => ({ i: (c.i + 1) % NICHES.length, step: 0, run: c.run + 1 })),
          HOLD_MS,
        );
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [i, run, manual, reduced]);

  // The connectors are drawn in pixels from where the cards really are, so they stay joined at any size.
  useLayoutEffect(() => {
    const box = stage.current;
    const mid = centre.current;
    if (!box || !mid) return;
    const measure = () => {
      if (window.matchMedia('(max-width: 720px)').matches) {
        setLinks([]);
        return;
      }
      const b = box.getBoundingClientRect();
      const c = mid.getBoundingClientRect();
      const cy = c.top + c.height / 2 - b.top;
      const next: Link[] = [];
      cards.current.forEach((el, k) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const left = k % 2 === 0;
        const x1 = (left ? c.left : c.right) - b.left;
        const x2 = (left ? r.right : r.left) - b.left;
        const y2 = r.top + r.height / 2 - b.top;
        const dx = x2 - x1;
        next.push({
          d: `M${x1} ${cy} C${x1 + dx / 2} ${cy} ${x2 - dx / 2} ${y2} ${x2} ${y2}`,
          from: [x1, cy],
          to: [x2, y2],
        });
      });
      setLinks(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [i]);

  const done = step >= LAST;
  const said = step === 0 || done ? null : n.hero.cards[step - 1];

  return (
    <div className="ha-wrap">
      <div
        ref={stage}
        className="ha"
        role="img"
        aria-label={`A ${n.industry.toLowerCase()} contact with appointments, messages, reminders and follow-ups connected around it`}
      >
        <svg className="ha-links" aria-hidden>
          {links.map((l, k) => (
            <g key={k}>
              <path className="ha-rail" d={l.d} />
              <path
                className="ha-wire"
                d={l.d}
                pathLength={1}
                style={{ strokeDashoffset: step > k ? 0 : 1 }}
              />
              {done && !reduced && (
                <circle className="ha-pulse" r="3.5">
                  <animateMotion
                    dur="2.8s"
                    begin={`${k * 0.45}s`}
                    repeatCount="indefinite"
                    path={l.d}
                  />
                </circle>
              )}
              <circle
                className={`ha-port${step > k ? ' on' : ''}`}
                cx={l.to[0]}
                cy={l.to[1]}
                r="4.5"
              />
              <circle
                className={`ha-port${step > 0 ? ' on' : ''}`}
                cx={l.from[0]}
                cy={l.from[1]}
                r="4.5"
              />
            </g>
          ))}
        </svg>
        <div ref={centre} className="ha-c" aria-hidden>
          <span key={n.id} className="ha-ind">
            <Icon name={n.icon} />
            {n.industry}
          </span>
          <div className="ha-av">
            <Portrait look={PORTRAIT_LOOKS[i % PORTRAIT_LOOKS.length]!} />
          </div>
          <b>{n.hero.name}</b>
          <span className="ha-role">{n.who}</span>
          <i>{n.hero.sub}</i>
          <span key={`${n.id}-${step}`} className={`ha-live${done ? ' done' : ''}`}>
            {done ? (
              <>
                <Icon name="check" />
                Handled, nothing missed
              </>
            ) : said ? (
              <>
                <Icon name="check" />
                {said.t}
              </>
            ) : (
              <>
                <span className="ha-dot" />
                New enquiry arrives
              </>
            )}
          </span>
        </div>
        <div key={n.id} className="ha-sats" aria-hidden>
          {n.hero.cards.map((c, k) => (
            <div
              key={c.t}
              ref={(el) => {
                cards.current[k] = el;
              }}
              className={`ha-s${step > k ? ' on' : ''}${step === k + 1 ? ' now' : ''}`}
              style={{ left: `${SPOTS[k]![0]}%`, top: `${SPOTS[k]![1]}%` }}
            >
              <div>
                <span className="ha-n">{k + 1}</span>
                <span className="ic">
                  <Icon name={c.icon} />
                </span>
                <span>
                  <b>{c.t}</b>
                  <i>{c.d}</i>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ha-tabs" role="tablist" aria-label="See it for your kind of business">
        {NICHES.map((x, k) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={k === i}
            onClick={() => {
              setSeq((c) => ({ i: k, step: 0, run: c.run + 1 }));
              setManual(true);
            }}
          >
            <Icon name={x.icon} />
            {x.industry}
          </button>
        ))}
      </div>
    </div>
  );
}
