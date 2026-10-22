import { describe, expect, it } from 'vitest';
import { newDraft, validateDraft } from './booking-form';
import { reminderKeys } from './reminder-rules';
import {
  COMMON_CURRENCIES,
  PROBLEM_CODES,
  QUICK_FOLLOW_UPS,
  QUICK_REMINDERS,
  addReminder,
  blockersOf,
  currencyChoices,
  draftPrice,
  draftSignature,
  firstBlocker,
  firstStepOfKeys,
  insertAtRange,
  moveItem,
  newQuestion,
  newReminder,
  publicLink,
  serverFieldKey,
  serverProblems,
  stepsWithProblems,
} from './editor';

const draft = () => newDraft({ timezone: 'UTC', currency: 'USD' });

describe('step blockers', () => {
  it('blocks step 1 on the name and step 2 on the duration, like Reference', () => {
    const d = { ...draft(), name: '', duration: '0' };
    const p = validateDraft(d);
    expect(blockersOf('service', p)).toEqual(['name']);
    expect(blockersOf('timing', p)).toEqual(['duration']);
    expect(blockersOf('availability', p)).toEqual([]);
  });

  it('does not block on a slug problem or any other', () => {
    const p = validateDraft({ ...draft(), name: 'Demo', slug: 'Not A Slug', taxPct: '200' });
    expect(Object.keys(p)).toContain('slug');
    expect(blockersOf('service', p)).toEqual([]);
  });

  it('finds the first step being left that has a blocker, and lets a move back through', () => {
    const p = validateDraft({ ...draft(), name: '', duration: 'x' });
    expect(firstBlocker('service', 'pricing', p)).toEqual({ step: 'service', key: 'name' });
    expect(firstBlocker('timing', 'messaging', p)).toEqual({ step: 'timing', key: 'duration' });
    expect(firstBlocker('availability', 'messaging', p)).toBeNull();
    expect(firstBlocker('timing', 'service', p)).toBeNull();
    expect(firstBlocker('service', 'service', p)).toBeNull();
  });

  it('finds the earliest step among problem keys, with its first key', () => {
    expect(firstStepOfKeys(['fee', 'duration', 'name'])).toEqual({ step: 'service', key: 'name' });
    expect(firstStepOfKeys(['taxPct', 'overrides', 'reminder:i4'])).toEqual({
      step: 'availability',
      key: 'overrides',
    });
    expect(firstStepOfKeys(['question:i2'])).toEqual({ step: 'messaging', key: 'question:i2' });
    expect(firstStepOfKeys([])).toBeNull();
  });

  it('lists the steps that hold a problem', () => {
    const p = validateDraft({ ...draft(), name: '', fee: 'abc' });
    expect([...stepsWithProblems(p)].sort()).toEqual(['pricing', 'service']);
  });
});

describe('problem codes', () => {
  it('names every code validateDraft can produce', () => {
    const d = {
      ...draft(),
      name: 'x'.repeat(300),
      slug: 'BAD SLUG',
      description: 'd'.repeat(3000),
      locationValue: 'l'.repeat(600),
      color: 'red',
      duration: '1',
      increment: '0',
      bufferBefore: '99999',
      minNotice: 'a',
      maxAdvance: '999',
      maxPerDay: '0',
      capacity: '0',
      timezone: 'Nowhere/Land',
      fee: 'x',
      taxPct: '300',
      cancelFee: 'z',
      cancelWindow: 'q',
    };
    for (const code of Object.values(validateDraft(d))) expect(PROBLEM_CODES).toContain(code);
  });
});

describe('server field errors', () => {
  it('maps the API field paths to the draft keys', () => {
    expect(serverFieldKey('durationMinutes')).toBe('duration');
    expect(serverFieldKey('price.feeMinor')).toBe('fee');
    expect(serverFieldKey('availability.2.from')).toBe('hours');
    expect(serverFieldKey('overrides.0.date')).toBe('overrides');
    expect(serverFieldKey('questions.3.label')).toBe('questions');
    expect(serverFieldKey('somethingElse')).toBeNull();
  });

  it('keeps the first message per key and drops unknown paths', () => {
    expect(
      serverProblems({
        durationMinutes: 'a',
        'price.feeMinor': 'b',
        unknown: 'c',
        'availability.0.to': 'd',
        availability: 'e',
      }),
    ).toEqual({
      duration: 'a',
      fee: 'b',
      hours: 'd',
    });
  });
});

describe('currencies', () => {
  it('offers the common codes sorted, plus the workspace and the current one', () => {
    const list = currencyChoices('xof', 'lyd');
    expect(list).toContain('XOF');
    expect(list).toContain('LYD');
    expect(list).toContain('USD');
    expect([...list]).toEqual([...list].sort((a, b) => a.localeCompare(b)));
    expect(new Set(list).size).toBe(list.length);
  });

  it('has no duplicates in the built-in list and only three-letter codes', () => {
    expect(new Set(COMMON_CURRENCIES).size).toBe(COMMON_CURRENCIES.length);
    for (const c of COMMON_CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/);
  });
});

describe('draftPrice', () => {
  it('prices a fee in major units with tax and a partial deposit', () => {
    const p = draftPrice({
      ...draft(),
      fee: '150.00',
      taxPct: '10',
      depositMode: 'partial',
      deposit: '50',
    });
    expect(p).toEqual({ feeMinor: 15000, taxMinor: 1500, totalMinor: 16500, dueNowMinor: 5000 });
  });

  it('asks for the whole total on a full deposit and nothing without one', () => {
    expect(
      draftPrice({ ...draft(), fee: '100', taxPct: '5', depositMode: 'full' }).dueNowMinor,
    ).toBe(10500);
    expect(
      draftPrice({ ...draft(), fee: '100', taxPct: '5', depositMode: 'none' }).dueNowMinor,
    ).toBe(0);
  });

  it('counts an unreadable box as zero and follows the currency decimals', () => {
    expect(draftPrice({ ...draft(), fee: 'abc' }).totalMinor).toBe(0);
    expect(draftPrice({ ...draft(), currency: 'JPY', fee: '1500' }).feeMinor).toBe(1500);
    expect(draftPrice({ ...draft(), currency: 'KWD', fee: '1.5' }).feeMinor).toBe(1500);
  });
});

describe('reminders', () => {
  it('quick-adds each chip once, and a rule is added OFF', () => {
    let list = addReminder([], 1440, '24 h');
    list = addReminder(list, 1440, '24 h');
    expect(list).toHaveLength(1);
    expect(list[0]!.enabled).toBe(false);
    list = addReminder(list, 60, '1 h');
    expect([...reminderKeys(list)].sort()).toEqual(['before:1440', 'before:60']);
    expect(QUICK_REMINDERS).toEqual([1440, 180, 60, 15]);
    expect(QUICK_FOLLOW_UPS).toEqual([120, 1440]);
  });

  it('the same moment before the start and after the end are two different rules', () => {
    let list = addReminder([], 60, '', 'before');
    list = addReminder(list, 60, '', 'after');
    expect(list.map((r) => r.kind)).toEqual(['before', 'after']);
    expect([...reminderKeys(list)].sort()).toEqual(['after:60', 'before:60']);
  });

  it('fills an empty row before adding another', () => {
    const list = addReminder([newReminder('', '')], 180, '3 h');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ offset: '3', unit: 'hours', label: '3 h' });
  });

  it('stops at five', () => {
    let list = [] as ReturnType<typeof addReminder>;
    for (let i = 1; i <= 8; i++) list = addReminder(list, i * 10);
    expect(list).toHaveLength(5);
    expect(addReminder(list, 999)).toHaveLength(5);
  });

  it('does not count an unreadable box as a moment', () => {
    expect(reminderKeys([newReminder('abc'), newReminder(''), newReminder(' 45 ')])).toEqual(
      new Set(['before:45']),
    );
  });
});

describe('moveItem', () => {
  it('moves an item up and down', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the list alone at either end and never changes the input', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(list, 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(list, 5, -1)).toEqual(['a', 'b']);
    expect(moveItem(list, 1, -1)).not.toBe(list);
    expect(list).toEqual(['a', 'b']);
  });
});

describe('insertAtRange', () => {
  it('inserts at the caret and returns the new caret', () => {
    expect(insertAtRange('Hello !', '{{name}}', 6, 6, 100)).toEqual({
      text: 'Hello {{name}}!',
      caret: 14,
    });
  });

  it('replaces a selection', () => {
    expect(insertAtRange('Hi XXX there', '{{name}}', 3, 6, 100)).toEqual({
      text: 'Hi {{name}} there',
      caret: 11,
    });
  });

  it('clamps a range outside the text and refuses what would be too long', () => {
    expect(insertAtRange('ab', 'X', 50, 90, 100)).toEqual({ text: 'abX', caret: 3 });
    expect(insertAtRange('abc', '{{manage_link}}', 3, 3, 5)).toBeNull();
  });
});

describe('questions and the form signature', () => {
  it('starts a question as a required text question, like Reference', () => {
    expect(newQuestion()).toMatchObject({
      label: '',
      type: 'text',
      required: true,
      map: '',
      optionsText: '',
    });
  });

  it('changes the signature only when something changed', () => {
    const d = draft();
    expect(draftSignature(d)).toBe(draftSignature({ ...d }));
    expect(draftSignature(d)).not.toBe(draftSignature({ ...d, name: 'x' }));
  });
});

describe('publicLink', () => {
  it('joins the origin, the workspace and the slug', () => {
    expect(publicLink('https://app.example.com', 'acme', 'discovery-call')).toBe(
      'https://app.example.com/book/acme/discovery-call',
    );
  });

  it('shows a stand-in for an empty slug and escapes odd characters', () => {
    expect(publicLink('https://x.y', 'acme', '  ')).toBe('https://x.y/book/acme/your-link');
    expect(publicLink('https://x.y', 'a b', 'c/d')).toBe('https://x.y/book/a%20b/c%2Fd');
  });
});
