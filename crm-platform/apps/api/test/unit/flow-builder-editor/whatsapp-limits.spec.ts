import { describe, expect, it } from 'vitest';
import { FLB_WA_LIMITS, flbAskOptionMax, flbWhatsappLimitProblems } from '@crm/contracts';

const x = (n: number) => 'x'.repeat(n);
const node = (type: string, data: Record<string, unknown>) => [{ id: 'n1', type, data }];

describe('flbWhatsappLimitProblems (Meta interactive message limits)', () => {
  it('accepts text exactly at every limit', () => {
    const buttons = node('buttons', {
      prompt: x(FLB_WA_LIMITS.body),
      options: ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)],
    });
    const list = node('list', {
      prompt: x(FLB_WA_LIMITS.body),
      button: x(FLB_WA_LIMITS.listButton),
      options: Array.from({ length: 10 }, (_, i) => ({
        title: `${i}`.repeat(24),
        description: x(72),
        section: x(24),
      })),
    });
    expect(flbWhatsappLimitProblems(buttons)).toEqual([]);
    expect(flbWhatsappLimitProblems(list)).toEqual([]);
  });

  it('flags a button name over 20 characters, more than 3 buttons and duplicate names', () => {
    const p = flbWhatsappLimitProblems(
      node('buttons', { prompt: 'Hi', options: [x(21), 'A', 'a', 'D'] }),
    ).map((i) => i.message);
    expect(p).toContain('Button 1 is longer than 20 characters.');
    expect(p).toContain('A WhatsApp buttons message has at most 3 buttons.');
    expect(p.some((m) => m.includes('same name'))).toBe(true);
  });

  it('flags list row title 25, description 73, section 25, button 21 and 11 rows', () => {
    const rows = Array.from({ length: 11 }, () => ({
      title: x(25),
      description: x(73),
      section: x(25),
    }));
    const p = flbWhatsappLimitProblems(
      node('list', { prompt: 'p', button: x(21), options: rows }),
    ).map((i) => i.message);
    expect(p).toContain('The list button is longer than 20 characters.');
    expect(p).toContain('A WhatsApp list has at most 10 items.');
    expect(p).toContain('List item 1 is longer than 24 characters.');
    expect(p).toContain('The description of list item 1 is longer than 72 characters.');
    expect(p).toContain('The section of list item 1 is longer than 24 characters.');
  });

  it('holds link buttons to a 20 character label, 2000 character address and 3 buttons', () => {
    const p = flbWhatsappLimitProblems(
      node('cta', {
        bodyText: x(1025),
        actions: [
          { type: 'url', label: x(21), value: `https://a.io/${x(2000)}` },
          { type: 'phone', label: 'Call', value: x(3000) },
          { type: 'url', label: 'ok', value: 'https://a.io' },
          { type: 'url', label: 'ok', value: 'https://a.io' },
        ],
      }),
    ).map((i) => i.message);
    expect(p).toContain('Link button 1 is longer than 20 characters.');
    expect(p).toContain('The address of link button 1 is longer than 2000 characters.');
    expect(p).toContain('The text above the link buttons is longer than 1024 characters.');
    expect(p).toContain('A link buttons step has at most 3 buttons.');
    expect(p.some((m) => m.includes('link button 2'))).toBe(false);
  });

  it('holds Ask answers to button (20) or list-row (24) length and the plain message to 4096', () => {
    expect(flbAskOptionMax(3)).toBe(20);
    expect(flbAskOptionMax(4)).toBe(24);
    expect(
      flbWhatsappLimitProblems(node('ask', { prompt: 'q', options: [x(21)] })).map(
        (i) => i.message,
      ),
    ).toEqual(['Answer 1 is longer than 20 characters.']);
    expect(flbWhatsappLimitProblems(node('message', { text: x(4097) }))).toHaveLength(1);
    expect(flbWhatsappLimitProblems(node('message', { text: x(4096) }))).toEqual([]);
  });

  it('reports the node it found the problem on and ignores other node types', () => {
    expect(flbWhatsappLimitProblems(node('buttons', { options: [x(30)] }))[0]?.nodeId).toBe('n1');
    expect(flbWhatsappLimitProblems(node('delay', { text: x(9000) }))).toEqual([]);
  });
});
