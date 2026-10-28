'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GOALS, TEAMS } from '../data/site';
import { PRODUCTS, hrefOf } from '../data/products';
import { Icon } from '../icons';

const solutionHref = (s: { kind: 'industry' | 'usecase'; slug: string }) =>
  s.kind === 'industry' ? `/solutions/${s.slug}` : `/use-cases/${s.slug}`;

/** "What do you want to do?": one goal, one kind of team, then a short list of pages to read next. */
export function GetStarted() {
  const [goalId, setGoalId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const goal = GOALS.find((g) => g.id === goalId);
  const team = TEAMS.find((t) => t.id === teamId);
  const done = !!goal && !!team;

  return (
    <div style={{ display: 'grid', gap: 40, maxWidth: 760, margin: '0 auto' }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="gx-h3" style={{ marginBottom: 14, fontSize: '1.2rem' }}>
          1. What is the main thing you want to do?
        </legend>
        <div className="gx-grid">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              className="gx-choice"
              aria-pressed={goalId === g.id}
              onClick={() => setGoalId(g.id)}
            >
              <span className="gx-drop-ic">
                <Icon name={g.icon} />
              </span>
              {g.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="gx-h3" style={{ marginBottom: 14, fontSize: '1.2rem' }}>
          2. What best describes you?
        </legend>
        <div className="gx-grid gx-grid-2">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="gx-choice"
              aria-pressed={teamId === t.id}
              onClick={() => setTeamId(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <section aria-live="polite" aria-label="Your recommendation">
        {done ? (
          <div className="gx-formcard">
            <div className="gx-eyebrow">Your starting point</div>
            <h2 className="gx-h2" style={{ fontSize: '1.6rem' }}>
              {goal.label}
            </h2>
            <p style={{ marginTop: 14 }}>These products cover it:</p>
            <div className="gx-grid gx-grid-3" style={{ marginTop: 12 }}>
              {goal.products
                .map((s) => PRODUCTS.find((p) => p.slug === s))
                .filter((p) => !!p)
                .map((p) => (
                  <Link key={p.slug} href={hrefOf(p)} className="gx-card" style={{ padding: 18 }}>
                    <div className="gx-ic">
                      <Icon name={p.icon} />
                    </div>
                    <h3 className="gx-h3">{p.name}</h3>
                    <p>{p.short}</p>
                  </Link>
                ))}
            </div>
            <div className="gx-cta-row">
              <Link href={solutionHref(goal.solution)} className="gx-btn gx-btn-primary">
                See the {goal.solution.kind === 'industry' ? 'solution' : 'use case'}{' '}
                <Icon name="arrow" />
              </Link>
              {team.solution && (
                <Link href={solutionHref(team.solution)} className="gx-btn gx-btn-ghost">
                  How {team.label.toLowerCase()} teams use it
                </Link>
              )}
              <Link href="/register" className="gx-btn gx-btn-ghost">
                Start free trial
              </Link>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--gx-mute)' }}>
            Pick one from each question and your recommendation appears here.
          </p>
        )}
      </section>
    </div>
  );
}
