import { describe, expect, it } from 'vitest';
import { turnOf } from './turn';

describe('turnOf', () => {
  it('counts the messages the person sent and keeps the last one as the prompt', () => {
    const r = turnOf([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '  Build a report  ' },
      { role: 'assistant', content: '' },
    ]);
    expect(r).toEqual({ turn: '2', prompt: 'Build a report' });
  });
  it('reads the text parts of a message with several parts', () => {
    expect(
      turnOf([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare' },
            { type: 'image' },
            { type: 'text', text: 'it' },
          ],
        },
      ]).prompt,
    ).toBe('Compare it');
  });
  it('copes with no messages at all', () => {
    expect(turnOf(undefined)).toEqual({ turn: '0', prompt: null });
    expect(turnOf([{ role: 'assistant', content: 'hi' }])).toEqual({ turn: '0', prompt: null });
  });
});
