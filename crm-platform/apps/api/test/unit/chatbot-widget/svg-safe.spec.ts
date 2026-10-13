import { describe, expect, it } from 'vitest';
import { isSafeSvg } from '../../../src/modules/chatbot-widget/svg-safe';

const svg = (inner: string, attrs = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`);

describe('isSafeSvg: an uploaded SVG is only ever a picture', () => {
  it('accepts plain shapes, gradients, styles and an embedded raster picture', () => {
    expect(isSafeSvg(svg('<rect width="10" height="10" fill="red"/>'))).toBe(true);
    expect(
      isSafeSvg(
        svg(
          '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" width="5" height="5"/><style>.a{fill:blue}</style>',
        ),
      ),
    ).toBe(true);
    expect(
      isSafeSvg(svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/>')),
    ).toBe(true);
    expect(isSafeSvg(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
  });

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an event handler', '<rect onload="x()" width="1" height="1"/>'],
    ['foreign content', '<foreignObject><div/></foreignObject>'],
    ['a javascript link', '<a href="javascript:alert(1)"><rect/></a>'],
    ['an external image', '<image href="https://evil.example/x.png"/>'],
    ['an external url()', '<rect style="fill:url(https://evil.example/x)"/>'],
    ['an @import', '<style>@import "https://evil.example/x.css";</style>'],
    ['an embedded page', '<image href="data:text/html;base64,PHNjcmlwdD4="/>'],
  ])('refuses %s', (_name, inner) => {
    expect(isSafeSvg(svg(inner))).toBe(false);
  });

  it('refuses a doctype or entity, a file that is not an SVG, an empty file and an oversized one', () => {
    expect(isSafeSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
    expect(isSafeSvg(Buffer.from('<html><svg/></html>'))).toBe(false);
    expect(isSafeSvg(Buffer.alloc(0))).toBe(false);
    expect(isSafeSvg(svg('<!--' + 'a'.repeat(1_048_600) + '-->'))).toBe(false);
  });
});
