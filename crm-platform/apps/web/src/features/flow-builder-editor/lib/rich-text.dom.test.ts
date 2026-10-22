// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarks, marksToHtml } from './rich-text';

const back = (text: string): string => {
  const box = document.createElement('div');
  box.innerHTML = marksToHtml(text);
  return htmlToMarks(box);
};

describe('rich text of the message box (dom)', () => {
  it('writes the marks back exactly', () => {
    for (const t of [
      '*Hello Welcome* to Geta.ai',
      'a\nb\n\nc',
      '- one\n- two',
      '1. a\n2. b',
      'x {{first_name}} _y_ ~z~ ```m```',
      'line\n',
    ])
      expect(back(t)).toBe(t);
  });

  it('writes marks around the words only, never the spaces', () => {
    const box = document.createElement('div');
    box.innerHTML = '<b>hi </b>there';
    expect(htmlToMarks(box)).toBe('*hi* there');
  });
});
