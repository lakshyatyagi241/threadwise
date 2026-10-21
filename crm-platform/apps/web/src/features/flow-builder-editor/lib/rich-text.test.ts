import { describe, expect, it } from 'vitest';
import { marksToHtml } from './rich-text';

describe('rich text of the message box', () => {
  it('shows the marks as words, without the marks', () => {
    expect(marksToHtml('*Hello Welcome* to Geta.ai')).toBe('<b>Hello Welcome</b> to Geta.ai');
    expect(marksToHtml('_a_ ~b~ ```c```')).toBe('<i>a</i> <s>b</s> <code>c</code>');
    expect(marksToHtml('*bold _and italic_*')).toBe('<b>bold <i>and italic</i></b>');
  });

  it('keeps variables whole and escapes html', () => {
    expect(marksToHtml('Hi {{first_name}}, _x_ {{last_name}}')).toBe(
      'Hi {{first_name}}, <i>x</i> {{last_name}}',
    );
    expect(marksToHtml('<b>&')).toBe('&lt;b&gt;&amp;');
  });

  it('leaves a mark with a space inside as it was typed', () => {
    expect(marksToHtml('2 * 3 * 4')).toBe('2 * 3 * 4');
  });
});
