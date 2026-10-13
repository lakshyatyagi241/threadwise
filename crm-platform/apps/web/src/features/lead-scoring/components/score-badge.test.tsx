// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, text, type Mounted } from '../testing';
import { ScoreBadge, type ScoreBadgeProps } from './score-badge';

let m: Mounted | null = null;
afterEach(async () => {
  await m?.unmount();
  m = null;
});
const badge = async (props: ScoreBadgeProps) => {
  m = await mount(<ScoreBadge {...props} />);
  return m.host.querySelector<HTMLElement>('[role="img"]')!;
};

describe('ScoreBadge', () => {
  it.each([
    [0, 'cold'],
    [33, 'cold'],
    [34, 'warm'],
    [66, 'warm'],
    [67, 'hot'],
    [100, 'hot'],
  ])('puts %i in the %s band and prints the number', async (score, band) => {
    const el = await badge({ score, source: 'manual' });
    expect(el.dataset.band).toBe(band);
    expect(el.textContent).toBe(String(score));
  });

  it('names the number, the band and the source for assistive technology', async () => {
    const el = await badge({ score: 72, source: 'ai', scoredAt: '2026-03-12T15:04:00.000Z' });
    expect(el.getAttribute('aria-label')).toBe('Lead score 72 out of 100, Hot, scored by AI');
    expect(el.getAttribute('title')).toContain('Scored by AI on');
    expect(el.getAttribute('title')).toContain('Mar 12, 2026');
  });

  it('marks an AI score with a sparkle and a person-entered one without', async () => {
    const ai = await badge({ score: 50, source: 'ai' });
    expect(ai.querySelector('svg')).not.toBeNull();
    await m?.unmount();
    const manual = await badge({ score: 50, source: 'manual' });
    expect(manual.querySelector('svg')).toBeNull();
    expect(manual.getAttribute('aria-label')).toContain('entered by a person');
    await m?.unmount();
    // A score typed before AI scoring existed has no source: it is a person's.
    const legacy = await badge({ score: 50, source: null });
    expect(legacy.dataset.source).toBe('manual');
  });

  it('shows a dash with a name when there is no score', async () => {
    const el = await badge({ score: null });
    expect(el.textContent).toBe('—');
    expect(el.getAttribute('aria-label')).toBe(text('badge.none'));
  });
});
