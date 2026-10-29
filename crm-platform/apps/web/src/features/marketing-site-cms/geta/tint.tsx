import type { CSSProperties } from 'react';
import { CountUp } from './count-up';
import type { Product } from './data/products';
import { Icon, type IconName } from './icons';
import './tint.css';

/** Soft tints used in turn, the same family as the home page. */
export const TINTS = ['#4338ca', '#0284c7', '#0f9488', '#d97706', '#7c3aed', '#db2777'];

/** The small drawn interface inside a card. Four shapes, repeated in turn, in the card tint. */
function Panel({ v, icon }: { v: number; icon: IconName }) {
  switch (v % 4) {
    case 0:
      return (
        <div className="cc-pn">
          <div className="cc-row">
            <span className="cc-chip">
              <Icon name={icon} />
            </span>
            <u style={{ width: '46%' }} />
            <s />
          </div>
          <u style={{ width: '88%' }} />
          <u style={{ width: '62%' }} />
        </div>
      );
    case 1:
      return (
        <div className="cc-pn">
          {[72, 56, 64].map((w, i) => (
            <div key={w} className="cc-row">
              <i className={i < 2 ? 'ok' : ''} />
              <u style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      );
    case 2:
      return (
        <div className="cc-pn">
          <div className="cc-row cc-chips">
            <b />
            <b />
            <b />
          </div>
          <u style={{ width: '82%' }} />
          <div className="cc-row">
            <span className="cc-chip">
              <Icon name={icon} />
            </span>
            <u style={{ width: '40%' }} />
          </div>
        </div>
      );
    default:
      return (
        <div className="cc-pn">
          <div className="cc-bars">
            {[38, 62, 46, 78, 58, 90].map((h, i) => (
              <em key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <u style={{ width: '54%' }} />
        </div>
      );
  }
}

/**
 * A grid of soft tinted cards: the words on top, and a small drawn interface that rises from the bottom edge of each card
 * over a faint shape. The wording comes from the product's own copy, so a card only claims what the product does; the drawn
 * panel is decoration and carries no text.
 */
export function TintGrid({ features }: { features: Product['features'] }) {
  return (
    <div className="cc">
      {features.map((f, i) => (
        <div
          key={f.title}
          className="cc-t"
          style={{ ['--h' as string]: TINTS[i % TINTS.length] } as CSSProperties}
        >
          <span className="cc-ic">
            <Icon name={f.icon} />
          </span>
          <h3>{f.title}</h3>
          <p>{f.text}</p>
          <div className="cc-stage" aria-hidden>
            <Panel v={i} icon={f.icon} />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface Stat {
  to: number;
  suffix?: string;
  label: string;
  text: string;
}

/**
 * Big numbers on tinted cards, each over a large translucent shape. The numbers are real counts taken from the site's own
 * data, so they never need to be kept true by hand.
 */
export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="sc">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="sc-c"
          style={{ ['--h' as string]: TINTS[(i * 2) % TINTS.length] } as CSSProperties}
        >
          <b className="sc-n">
            <CountUp to={s.to} suffix={s.suffix} />
          </b>
          <h3>{s.label}</h3>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  );
}
