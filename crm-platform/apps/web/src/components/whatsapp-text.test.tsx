import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhatsAppText } from './whatsapp-text';

const html = (text: string, variables = false) =>
  renderToStaticMarkup(<WhatsAppText text={text} variables={variables} />);

describe('WhatsAppText', () => {
  it('draws bold, italic, strike and monospace as elements', () => {
    const out = html('*Bold* _it_ ~gone~ ```x```');
    expect(out).toMatch(/<strong><span>Bold<\/span><\/strong>/);
    expect(out).toMatch(/<em><span>it<\/span><\/em>/);
    expect(out).toMatch(/<del><span>gone<\/span><\/del>/);
    expect(out).toContain('<code');
  });

  it('draws lists and quotes', () => {
    expect(html('- one\n- two')).toContain('<ul');
    expect(html('1. one')).toContain('<ol');
    expect(html('> quoted')).toContain('<blockquote');
  });

  it('escapes html, so a message cannot inject markup', () => {
    const out = html('<img src=x onerror=alert(1)> *b*');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('keeps {{name}} as text in a message, a pill in a template', () => {
    expect(html('hi {{name}}')).toContain('hi {{name}}');
    expect(html('hi {{name}}', true)).toContain('bg-success/15');
  });
});
