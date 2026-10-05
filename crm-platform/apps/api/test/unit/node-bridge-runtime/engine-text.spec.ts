import { describe, expect, it } from 'vitest';
import { commandForText, renderPlainBody } from '../../../src/modules/broadcasts/engine-senders';

describe('plain-text engines', () => {
  it('fills positional and named tags, empty when missing', () => {
    expect(renderPlainBody('Hi {{1}}, order {{2}} {{3}}', ['Ann', '42'])).toBe('Hi Ann, order 42 ');
    expect(renderPlainBody('Hi {{name}} {{city}} {{name}}', ['Ann', 'Pune'])).toBe(
      'Hi Ann Pune Ann',
    );
  });
  it('joins header, body, footer; media carries them as caption', () => {
    const m = { to: '1', text: 'b', header: 'h', footer: 'f', clientReference: 'c' };
    expect(commandForText(m)).toEqual({ type: 'text', to: '1', body: 'h\n\nb\n\nf' });
    expect(commandForText({ ...m, media: { kind: 'image', url: 'https://x/a.jpg' } })).toEqual({
      type: 'media',
      to: '1',
      mediaUrl: 'https://x/a.jpg',
      caption: 'h\n\nb\n\nf',
    });
  });
});
