import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewFonts } from './preview-fonts';

describe('PreviewFonts', () => {
  it('puts the guest font classes on a wrapper that draws no box', () => {
    const html = renderToStaticMarkup(
      createElement(PreviewFonts, {
        fontClass: 'serif-a sans-b mono-c',
        children: createElement('p', null, 'x'),
      }),
    );
    expect(html).toBe('<div class="contents serif-a sans-b mono-c"><p>x</p></div>');
  });

  it('is a plain wrapper when no classes are given', () => {
    expect(
      renderToStaticMarkup(createElement(PreviewFonts, { children: createElement('i') })),
    ).toBe('<div class="contents"><i></i></div>');
  });
});
