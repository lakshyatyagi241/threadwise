'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HOME_AGENTS } from './data/site';
import { Icon } from './icons';

/** "One agent, every channel": tabs that auto-advance until the visitor picks one, each with a sample conversation. */
export function AgentTabs() {
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % HOME_AGENTS.length), 5000);
    return () => clearInterval(t);
  }, [manual]);
  const a = HOME_AGENTS[i]!;
  return (
    <div>
      <div
        className="gx-filters"
        role="tablist"
        aria-label="Agent types"
        style={{ justifyContent: 'center' }}
      >
        {HOME_AGENTS.map((x, n) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            id={`gx-agent-tab-${x.id}`}
            aria-selected={n === i}
            aria-controls="gx-agent-panel"
            className="gx-chip gx-chip-icon"
            aria-pressed={n === i}
            onClick={() => {
              setI(n);
              setManual(true);
            }}
          >
            <Icon name={x.icon} />
            {x.label}
          </button>
        ))}
      </div>
      <div
        id="gx-agent-panel"
        role="tabpanel"
        aria-labelledby={`gx-agent-tab-${a.id}`}
        className="gx-split gx-agent-panel"
      >
        <div key={a.id} className="gx-fade">
          <h3 className="gx-h2" style={{ fontSize: 'clamp(1.4rem, 2.6vw, 2rem)' }}>
            {a.headline}
          </h3>
          <p className="gx-lead">{a.body}</p>
          <ul className="gx-list">
            {a.bullets.map((b) => (
              <li key={b}>
                <Icon name="check" />
                {b}
              </li>
            ))}
          </ul>
          <Link href={a.href} className="gx-more">
            Learn more <Icon name="arrow" />
          </Link>
        </div>
        <div
          key={`${a.id}-chat`}
          className="gx-win gx-fade"
          role="img"
          aria-label={`Example ${a.label} conversation`}
        >
          <div className="gx-win-bar">
            <span className="gx-dot" />
            <span className="gx-dot" />
            <span className="gx-dot" />
            <span style={{ marginLeft: 8 }}>{a.label} · sample</span>
          </div>
          <div className="gx-chat">
            {a.chat.map((l, n) => (
              <div
                key={n}
                className={`gx-bub ${l.from === 'customer' ? 'gx-in' : 'gx-out'}`}
                style={{ animationDelay: `${n * 0.35}s` }}
              >
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
