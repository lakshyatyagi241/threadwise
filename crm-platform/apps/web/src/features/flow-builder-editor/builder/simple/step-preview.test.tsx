import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { newStep, stepText } from '../../lib/simple-model';
import { StepPreview, StepText } from './step-preview';

// Messages are not loaded here: the key is the text.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

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

describe('the closed card of a carousel step', () => {
  const card = (n: number) => ({
    image: n % 2 ? `https://cdn.example/${n}.png` : '',
    title: `Card ${n}`,
    text: `About ${n}`,
    buttons: [{ type: 'reply', label: `Pick ${n}` }],
  });

  it('shows one card at a time with a dot for each card and a next arrow, and no previous one on the first', () => {
    const step = { ...newStep('carousel', []), data: { cards: [1, 2, 3, 4, 5].map(card) } };
    const html = renderToStaticMarkup(<StepPreview step={step} />);
    expect(html.match(/data-testid="carousel-card"/g)).toHaveLength(1);
    expect(html).toContain('Card 1');
    expect(html).toContain('Pick 1');
    expect(html).not.toContain('Card 2');
    expect(html.match(/carousel\.goTo/g)).toHaveLength(5);
    expect(html).toContain('carousel.next');
    expect(html).not.toContain('carousel.prev');
  });

  it('has no dots or arrows for a single card, and draws nothing for none', () => {
    const one = { ...newStep('carousel', []), data: { cards: [card(1)] } };
    const html = renderToStaticMarkup(<StepPreview step={one} />);
    expect(html).not.toContain('carousel.goTo');
    expect(html).not.toContain('carousel.next');
    const none = { ...newStep('carousel', []), data: { cards: [] } };
    expect(renderToStaticMarkup(<StepPreview step={none} />)).toBe('');
  });
});
