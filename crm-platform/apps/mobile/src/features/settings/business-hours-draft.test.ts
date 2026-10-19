import { ownerWorkweek, withBreak, workweek } from '@/test/business-hours-fixtures';
import { checkDraft, draftFrom, maskTime, toUpdateInput } from './business-hours-draft';

describe('checkDraft', () => {
  it('has no problems for a saved schedule', () => {
    expect(checkDraft(draftFrom(workweek))).toEqual({});
  });

  it('finds an empty time, a time that is not HH:MM, and equal times, day by day', () => {
    const draft = draftFrom(workweek);
    draft.days.mon.from = '';
    draft.days.tue.to = '9:5';
    draft.days.wed.to = '09:00';
    expect(checkDraft(draft)).toEqual({ mon: 'required', tue: 'format', wed: 'same' });
  });

  it('accepts 24:00 as a closing time and a closing time before the opening one (an overnight window)', () => {
    const draft = draftFrom(workweek);
    draft.days.mon.to = '24:00';
    draft.days.tue.from = '22:00';
    draft.days.tue.to = '06:00';
    expect(checkDraft(draft)).toEqual({});
  });

  it('refuses an opening time of 24:00 and an hour past it', () => {
    const draft = draftFrom(workweek);
    draft.days.mon.from = '24:00';
    draft.days.tue.to = '25:00';
    expect(checkDraft(draft)).toEqual({ mon: 'format', tue: 'format' });
  });
});

describe('toUpdateInput', () => {
  it('sends the time zone only for a person who may change it', () => {
    expect(toUpdateInput(draftFrom(ownerWorkweek), true)).toMatchObject({
      timezone: 'Asia/Kolkata',
    });
    expect(toUpdateInput(draftFrom(workweek), false)).not.toHaveProperty('timezone');
  });

  it('sends all seven days and leaves the holidays out', () => {
    const body = toUpdateInput(draftFrom(workweek), false);
    expect(Object.keys(body.days)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(body).not.toHaveProperty('holidays');
  });

  it('carries a break set on the web through a save', () => {
    expect(toUpdateInput(draftFrom(withBreak), false).days.mon).toEqual({
      enabled: true,
      from: '09:00',
      to: '13:00',
      extra: [{ from: '14:00', to: '18:00' }],
    });
  });
});

describe('maskTime', () => {
  it('puts the colon in as the digits are typed, and keeps at most four digits', () => {
    expect(maskTime('')).toBe('');
    expect(maskTime('9')).toBe('9');
    expect(maskTime('09')).toBe('09');
    expect(maskTime('093')).toBe('09:3');
    expect(maskTime('0930')).toBe('09:30');
    expect(maskTime('09301')).toBe('09:30');
  });

  it('drops everything that is not a digit, and lets the colon be backspaced over', () => {
    expect(maskTime('09:30')).toBe('09:30');
    expect(maskTime('09:3')).toBe('09:3');
    expect(maskTime('09:')).toBe('09');
    expect(maskTime('ab1c2')).toBe('12');
  });
});
