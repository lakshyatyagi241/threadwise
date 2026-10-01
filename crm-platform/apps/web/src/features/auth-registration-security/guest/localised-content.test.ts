import { describe, expect, it } from 'vitest';
import { withLocalisedDefaults } from './localised-content';

const content = {
  eyebrow: 'Team inbox for WhatsApp',
  heading: 'Every customer chat,',
  headingAccent: 'one calm workspace',
  subheading: 'English default',
  accent: '#0f766e',
};

describe('withLocalisedDefaults', () => {
  it('swaps in local copy only for the fields the admin left empty', () => {
    const out = withLocalisedDefaults(content, ['eyebrow', 'subheading'], (f) => `ar:${f}`);
    expect(out.eyebrow).toBe('ar:eyebrow');
    expect(out.subheading).toBe('ar:subheading');
    expect(out.heading).toBe('Every customer chat,');
    expect(out.headingAccent).toBe('one calm workspace');
    expect(out.accent).toBe('#0f766e');
  });

  it('keeps the API text when there is no local copy for a field', () => {
    const out = withLocalisedDefaults(content, ['heading'], () => undefined);
    expect(out).toEqual(content);
  });

  it('returns the same object when nothing is defaulted', () => {
    expect(withLocalisedDefaults(content, [], () => 'x')).toBe(content);
    expect(withLocalisedDefaults(content, undefined, () => 'x')).toBe(content);
  });

  it('does not mutate its input', () => {
    withLocalisedDefaults(content, ['heading'], () => 'changed');
    expect(content.heading).toBe('Every customer chat,');
  });
});
