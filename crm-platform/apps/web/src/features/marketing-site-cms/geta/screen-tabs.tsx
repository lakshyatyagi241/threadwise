'use client';

import { useEffect, useState } from 'react';
import { MockFrame } from './mocks';

export interface ScreenShot {
  id: string;
  label: string;
  alt: string;
  caption: string;
}

/** "See it in the app": tabs over drawn app screens; auto-advances until the visitor picks one. */
export function ScreenTabs({ shots }: { shots: ScreenShot[] }) {
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual || shots.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const t = setInterval(() => setI((n) => (n + 1) % shots.length), 6000);
    return () => clearInterval(t);
  }, [manual, shots.length]);
  const s = shots[i];
  if (!s) return null;
  return (
    <div>
      <div className="gx-tabs" role="tablist" aria-label="App screens">
        {shots.map((x, n) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`gx-shot-tab-${x.id}`}
            aria-selected={n === i}
            aria-controls="gx-shot-panel"
            className="gx-tab"
            onClick={() => {
              setI(n);
              setManual(true);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div
        id="gx-shot-panel"
        role="tabpanel"
        aria-labelledby={`gx-shot-tab-${s.id}`}
        key={s.id}
        className="gx-fade"
      >
        <MockFrame id={s.id} alt={s.alt} />
        <p className="gx-shotcap">{s.caption}</p>
      </div>
    </div>
  );
}
