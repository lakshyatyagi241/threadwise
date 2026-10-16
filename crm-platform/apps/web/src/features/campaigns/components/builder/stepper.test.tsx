import { describe, expect, it } from 'vitest';
import { html } from '../../wizard/testing';
import { Stepper } from './stepper';

const none = () => undefined;
const render = (current: Parameters<typeof Stepper>[0]['current']) =>
  html(<Stepper current={current} reachable={() => true} onGo={none} />);
const dots = (out: string) => out.match(/<button[\s\S]*?<\/button>/g) ?? [];
const icon = (button: string) => /<svg[\s\S]*?<\/svg>/.exec(button)?.[0] ?? '';

describe('the builder stepper', () => {
  it('has the five steps, each with its own icon', () => {
    const buttons = dots(render('setup'));
    expect(buttons).toHaveLength(5);
    const icons = buttons.map(icon);
    expect(icons.every((i) => i !== '')).toBe(true);
    expect(new Set(icons).size).toBe(5);
  });

  it('shows a check in place of the icon once a step is done, and keeps the step number for screen readers', () => {
    const buttons = dots(render('schedule'));
    const check = 'M3 8l3 3 7-7';
    expect(buttons.filter((b) => icon(b).includes(check))).toHaveLength(3);
    expect(icon(buttons[3]!)).not.toContain(check);
    expect(buttons[0]).toContain('<span class="sr-only">1</span>');
    expect(buttons[4]).toContain('<span class="sr-only">5</span>');
  });

  it('marks the current step', () => {
    expect(render('recipients').match(/aria-current="step"/g)).toHaveLength(1);
  });
});
