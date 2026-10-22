import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newStep, stepText } from '../../lib/simple-model';
import { StepText } from './step-preview';

describe('the closed card text of a message-like step', () => {
  it('shows the question of a closed Ask for file step, not the empty fallback', () => {
    const step = { ...newStep('ask_file', []), data: { prompt: 'Send your ID, {{name}}' } };
    const html = renderToStaticMarkup(<StepText text={stepText(step)} fallback="Empty" />);
    expect(html).toContain('Send your ID, {{name}}');
    expect(html).not.toContain('>Empty<');
  });

  it('draws the marks as formatting and keeps every line break', () => {
    const html = renderToStaticMarkup(<StepText text={'*Welcome*\nHi _there_'} fallback="Empty" />);
    expect(html).toContain('<b>Welcome</b><br>Hi <i>there</i>');
  });

  it('escapes the author text, so it cannot add markup', () => {
    const html = renderToStaticMarkup(<StepText text="<img src=x onerror=1>" fallback="Empty" />);
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).not.toContain('<img');
  });

  it('shows the fallback when the text is blank', () => {
    const html = renderToStaticMarkup(<StepText text="   " fallback="Empty" />);
    expect(html).toContain('>Empty<');
  });
});
