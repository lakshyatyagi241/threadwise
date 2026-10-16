import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormattedText } from './formatted-text';

const html = (t: string) => renderToStaticMarkup(<FormattedText text={t} />);

describe('FormattedText', () => {
  it('draws *bold*, _italic_ and ~strike~ without their marks', () => {
    expect(html('*kkk*')).toBe('<strong class="font-semibold">kkk</strong>');
    expect(html('say _hi_ now')).toBe('say <em>hi</em> now');
    expect(html('~old~')).toBe('<s>old</s>');
  });
  it('reads a mark pair that closes a word, as in sdfg_ddd_', () => {
    expect(html('sdfg_ddd_')).toBe('sdfg<em>ddd</em>');
  });
  it('nests marks and keeps code and links as written', () => {
    expect(html('*a _b_ c*')).toBe('<strong class="font-semibold">a <em>b</em> c</strong>');
    expect(html('`x_y_z`')).toContain('<code');
    expect(html('see https://a.test/x_y_z now')).toBe('see https://a.test/x_y_z now');
  });
  it('leaves identifiers, lone marks and spaced marks alone', () => {
    expect(html('snake_case_word')).toBe('snake_case_word');
    expect(html('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(html('a * b')).toBe('a * b');
  });
  it('turns "- " lines into bullets and keeps numbered lines and breaks', () => {
    expect(html('- one\n- two\n1. x')).toBe(
      '<span aria-hidden="true">• </span>one\n<span aria-hidden="true">• </span>two\n1. x',
    );
  });
  it('never reads text as HTML', () => {
    expect(html('<b>x</b> *y*')).toBe(
      '&lt;b&gt;x&lt;/b&gt; <strong class="font-semibold">y</strong>',
    );
  });
});
