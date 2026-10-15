import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, type BuilderForm } from './builder-model';
import {
  applyAiCopy,
  countCsvRows,
  countNumbers,
  emailSkipped,
  firstBrokenStep,
  initialRecipientMode,
  recipientTotals,
  stepProblems,
  withRecipientMode,
} from './wizard-model';

const form = (p: Partial<BuilderForm> = {}): BuilderForm => ({
  ...EMPTY_FORM,
  type: 'custom',
  senderKey: 'baileys:1',
  ...p,
});

describe('which step a problem belongs to', () => {
  it('sends each problem to the step where it is fixed', () => {
    expect(stepProblems(form(), 'setup')).toEqual(['name']);
    expect(stepProblems(form({ senderKey: '' }), 'setup')).toEqual(['name', 'sender']);
    expect(stepProblems(form(), 'compose')).toEqual(['message']);
    expect(stepProblems(form(), 'recipients')).toEqual(['audience']);
    expect(stepProblems(form({ scheduleType: 'scheduled' }), 'schedule')).toEqual(['date', 'time']);
  });

  it('a draft does not need recipients', () => {
    expect(stepProblems(form(), 'recipients', { draft: true })).toEqual([]);
  });

  it('finds the first step still broken, or none', () => {
    expect(firstBrokenStep(form())).toBe('setup');
    expect(firstBrokenStep(form({ name: 'x', senderKey: '' }))).toBe('setup');
    expect(firstBrokenStep(form({ name: 'x', customMessage: 'hi' }))).toBe('recipients');
    expect(
      firstBrokenStep(form({ name: 'x', customMessage: 'hi', manualNumbers: '919800000001' })),
    ).toBeNull();
  });
});

describe('recipient modes', () => {
  it('opens a campaign on the mode that holds its recipients', () => {
    expect(initialRecipientMode(form({ groupIds: ['g'] }))).toBe('audience');
    expect(initialRecipientMode(form({ csvText: 'a\nb' }))).toBe('csv');
    expect(initialRecipientMode(form({ manualNumbers: '1' }))).toBe('manual');
    expect(initialRecipientMode(form())).toBe('audience');
  });

  it('switching mode clears what the other modes held', () => {
    const f = form({ groupIds: ['g'], manualNumbers: '1', csvText: 'x' });
    expect(withRecipientMode(f, 'csv')).toEqual({
      contactIds: [],
      groupIds: [],
      tagIds: [],
      segmentIds: [],
      manualNumbers: '',
    });
    expect(withRecipientMode(f, 'audience')).toEqual({ csvText: '', manualNumbers: '' });
  });

  it('counts numbers and CSV rows', () => {
    expect(countNumbers('919800000001\n919800000002, 919800000003;')).toBe(3);
    expect(countCsvRows('name,phone\nA,1\nB,2\n')).toBe(2);
    expect(countCsvRows('')).toBe(0);
  });

  it('totals groups, tags, contacts and numbers', () => {
    const f = form({
      groupIds: ['g1'],
      tagIds: ['t1'],
      contactIds: ['c1', 'c2'],
      manualNumbers: '1\n2',
    });
    expect(recipientTotals(f, { groups: { g1: 10 }, tags: { t1: 5 } })).toEqual({
      groups: 15,
      contacts: 2,
      numbers: 2,
      total: 19,
    });
  });
});

describe('Build with AI', () => {
  const copy = {
    campaignName: 'spring',
    message: 'Hi {{name}}',
    footer: 'Reply STOP',
    buttonText: 'Shop',
    buttonUrl: 'https://x.test',
    quickReplies: ['Yes', 'No', 'Later'],
  };

  it('fills the message, footer and at most three buttons, link first', () => {
    const f = applyAiCopy(form({ type: 'text' }), copy);
    expect(f.type).toBe('custom');
    expect(f.customMessage).toBe('Hi {{name}}');
    expect(f.customFooter).toBe('Reply STOP');
    expect(f.buttons.map((b) => b.type)).toEqual(['url', 'quick_reply', 'quick_reply']);
  });

  it('keeps a name the person typed', () => {
    expect(applyAiCopy(form({ name: 'Mine' }), copy).name).toBe('Mine');
    expect(applyAiCopy(form(), copy).name).toBe('spring');
  });

  it('adds no link button without both a label and an address', () => {
    const f = applyAiCopy(form(), { ...copy, buttonUrl: '', quickReplies: ['Yes'] });
    expect(f.buttons).toEqual([{ type: 'quick_reply', text: 'Yes', value: 'Yes' }]);
  });
});

describe('emailSkipped: who an email campaign cannot reach, as far as the screen knows', () => {
  const contacts = [
    { id: 'a', email: 'a@x.test' },
    { id: 'b', email: null },
    { id: 'c', email: '  ' },
  ];

  it('counts picked contacts with no address, and every typed or uploaded number', () => {
    const f = {
      ...EMPTY_FORM,
      contactIds: ['a', 'b', 'c'],
    };
    expect(emailSkipped(f, contacts)).toEqual({ contacts: 2, numbers: 0, total: 2 });
    expect(
      emailSkipped(
        { ...EMPTY_FORM, manualNumbers: '9198\n9199', csvText: 'name,phone\nA,1' },
        contacts,
      ),
    ).toEqual({ contacts: 0, numbers: 3, total: 3 });
  });

  it('a picked contact the loaded list does not carry is not guessed', () => {
    expect(emailSkipped({ ...EMPTY_FORM, contactIds: ['zzz'] }, contacts).total).toBe(0);
  });
});
