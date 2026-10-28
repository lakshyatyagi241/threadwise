'use client';

import Link from 'next/link';
import { useState } from 'react';
import { NICHES } from './data/niches';
import { Icon } from './icons';
import './adaptive.css';

/**
 * "Pick your business": each kind of business shows the few things it turns on, what it can ignore, a sample conversation and
 * the outcomes that follow. There are no fixed packages here; it is a starting point, and more can be switched on later.
 */
export function NichePicker() {
  const [i, setI] = useState(0);
  const n = NICHES[i]!;
  return (
    <div className="np">
      <div className="np-chips" role="tablist" aria-label="Choose your kind of business">
        {NICHES.map((x, k) => (
          <button key={x.id} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)}>
            <Icon name={x.icon} />
            {x.label}
          </button>
        ))}
        <Link href="/get-started">
          <Icon name="search" />
          Something else
        </Link>
      </div>
      <div className="np-panel" key={n.id}>
        <div className="np-left">
          <h3>{n.headline}</h3>
          <p>{n.blurb}</p>
          <p className="np-h">Turned on</p>
          <ul className="np-on">
            {n.on.map((t, k) => (
              <li key={t} style={{ animationDelay: `${0.1 + k * 0.12}s` }}>
                <Icon name="check" />
                {t}
              </li>
            ))}
          </ul>
          <p className="np-h">You can ignore</p>
          <ul className="np-off">
            {n.off.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="np-cta">
            <Link href="/register" className="gx-btn gx-btn-primary">
              Start free trial
            </Link>
            <Link href={n.href} className="gx-btn gx-btn-ghost">
              See the full setup
            </Link>
          </div>
        </div>
        <div className="np-right" aria-hidden>
          <div className="np-chat">
            {n.chat.map((m, k) => (
              <p key={k} className={`np-b ${m.from}`} style={{ animationDelay: `${0.3 + k * 0.6}s` }}>
                {m.text}
              </p>
            ))}
          </div>
          <div className="np-out">
            {n.cards.map((c, k) => (
              <div key={c.t} className="np-card" style={{ animationDelay: `${2.2 + k * 0.35}s` }}>
                <span className="np-ic">
                  <Icon name={c.icon} />
                </span>
                <span>
                  <b>{c.t}</b>
                  <i>{c.d}</i>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
