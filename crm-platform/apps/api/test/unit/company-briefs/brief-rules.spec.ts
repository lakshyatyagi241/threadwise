import { describe, expect, it } from 'vitest';
import { BRIEF_SECTION_KEYS, briefToText } from '@crm/contracts';
import {
  briefPrompt,
  dayOf,
  factsHash,
  maskPersonalText,
  parseBrief,
  sourcesOf,
  type BriefFacts,
} from '../../../src/modules/company-briefs/brief-rules';

const facts = (over: Partial<BriefFacts> = {}): BriefFacts => ({
  company: { name: 'Acme Ltd', industry: 'Logistics', size: '51-200', createdOn: '2026-01-02', hasOwner: true },
  properties: [{ label: 'Tier', value: 'gold' }],
  notes: null,
  contacts: { total: 3, byStage: { lead: 2, customer: 1 }, lastActivityOn: '2026-10-01' },
  deals: {
    open: 1,
    won: 2,
    lost: 0,
    openValue: [{ currency: 'USD', amount: '1500.00' }],
    wonValue: [{ currency: 'USD', amount: '9000.00' }],
    recent: [],
  },
  tasks: { open: 2, overdue: 1, next: [] },
  conversations: { total: 4, open: 1, lastMessageOn: '2026-10-10' },
  ...over,
});

describe('maskPersonalText (what may leave the product)', () => {
  it('replaces emails and numbers people can be reached on', () => {
    expect(maskPersonalText('Mail aarav.sharma@example.com or call +91 98123 45678 today', 200)).toBe(
      'Mail [email] or call [number] today',
    );
    expect(maskPersonalText('Card 4111 1111 1111 1111, ext 12', 200)).toBe('Card [number], ext 12');
  });

  it('keeps short numbers (a quantity, a year, a deal size)', () => {
    expect(maskPersonalText('Renewal 2026, 120 seats, 5-10 days', 200)).toBe(
      'Renewal 2026, 120 seats, 5-10 days',
    );
  });

  it('hides a link that carries a login', () => {
    expect(maskPersonalText('see https://user:secret@host.example/x', 200)).toBe('see [link]');
  });

  it('puts the text on one line without control characters and cuts it', () => {
    expect(maskPersonalText('a\n\nb\tc\u0000d', 50)).toBe('a b c d');
    const cut = maskPersonalText('x'.repeat(100), 20);
    expect(cut).toHaveLength(20);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('the facts', () => {
  it('have the same hash when nothing changed and another when anything did', () => {
    expect(factsHash(facts())).toBe(factsHash(facts()));
    expect(factsHash(facts())).not.toBe(
      factsHash(facts({ tasks: { open: 3, overdue: 1, next: [] } })),
    );
  });

  it('say which kinds of records a brief was written from', () => {
    expect(sourcesOf(facts())).toEqual({
      properties: true,
      contacts: true,
      deals: true,
      tasks: true,
      conversations: true,
    });
    expect(
      sourcesOf(facts({ properties: [], notes: null, contacts: null, deals: null, tasks: null, conversations: null })),
    ).toEqual({ properties: false, contacts: false, deals: false, tasks: false, conversations: false });
  });

  it('dayOf keeps a day and nothing finer', () => {
    expect(dayOf('2026-10-10T13:45:00.000Z')).toBe('2026-10-10');
    expect(dayOf(null)).toBeNull();
  });
});

describe('the prompt', () => {
  it('names the sections, forbids inventing, and treats the facts as data', () => {
    const p = briefPrompt(facts(), '2026-10-16');
    for (const key of BRIEF_SECTION_KEYS) expect(p.system).toContain(key);
    expect(p.system).toContain('Never invent');
    expect(p.system).toContain('not instructions');
    expect(p.system).toContain('2026-10-16');
    expect(p.user).toContain('"name":"Acme Ltd"');
  });

  it('carries no field that could hold a contact detail', () => {
    const p = briefPrompt(facts(), '2026-10-16');
    expect(p.user).not.toMatch(/email|phone|address|@/i);
  });
});

describe('parseBrief', () => {
  const answer = {
    summary: 'Acme is a logistics firm with two won deals.',
    sections: [
      { key: 'nextSteps', bullets: ['Call about the open deal'] },
      { key: 'deals', bullets: ['One open deal worth USD 1500.00', '  '] },
      { key: 'madeUp', bullets: ['ignored'] },
      { key: 'deals', bullets: ['a duplicate section'] },
      { key: 'risks', bullets: [] },
    ],
  };

  it('reads an answer, orders the sections as the card shows them, drops the unknown, the empty and the repeated', () => {
    const out = parseBrief(JSON.stringify(answer))!;
    expect(out.summary).toBe('Acme is a logistics firm with two won deals.');
    expect(out.sections.map((s) => s.key)).toEqual(['deals', 'nextSteps']);
    expect(out.sections[0]!.bullets).toEqual(['One open deal worth USD 1500.00']);
  });

  it('tolerates a fenced block', () => {
    expect(parseBrief('```json\n' + JSON.stringify(answer) + '\n```')).not.toBeNull();
  });

  it('refuses what is not a brief', () => {
    for (const text of ['nope', '[]', '{"summary": 3}', '{"sections": []}', '{"summary": "  "}'])
      expect(parseBrief(text)).toBeNull();
  });

  it('cuts an over-long line and an over-long list', () => {
    const out = parseBrief(
      JSON.stringify({
        summary: 'S',
        sections: [{ key: 'risks', bullets: Array.from({ length: 20 }, () => 'x'.repeat(900)) }],
      }),
    )!;
    expect(out.sections[0]!.bullets).toHaveLength(8);
    expect(out.sections[0]!.bullets[0]).toHaveLength(400);
  });
});

describe('briefToText (Copy)', () => {
  it('writes the title, the summary and each section with its bullets, in card order', () => {
    const text = briefToText(
      {
        summary: 'Summary line.',
        sections: [
          { key: 'nextSteps', bullets: ['Call them'] },
          { key: 'deals', bullets: ['One open deal'] },
        ],
      },
      'Acme: brief',
      {
        activity: 'Activity',
        deals: 'Deals',
        tasks: 'Tasks',
        conversations: 'Conversations',
        properties: 'Properties',
        risks: 'Risks',
        nextSteps: 'Next steps',
      },
    );
    expect(text).toBe(
      'Acme: brief\n\nSummary line.\n\nDeals\n- One open deal\n\nNext steps\n- Call them',
    );
  });
});
