import { describe, expect, it } from 'vitest';
import type { BusinessHours } from '@crm/contracts';
import { checkDraft, draftFrom, toUpdateInput } from './business-hours';

const hours: BusinessHours = {
  timezone: 'Asia/Kolkata',
  canEditTimezone: true,
  days: {
    mon: { enabled: true, from: '09:00', to: '18:00' },
    tue: { enabled: true, from: '09:00', to: '18:00' },
    wed: { enabled: true, from: '09:00', to: '18:00' },
    thu: { enabled: true, from: '09:00', to: '18:00' },
    fri: { enabled: true, from: '09:00', to: '18:00' },
    sat: { enabled: false, from: '09:00', to: '18:00' },
    sun: { enabled: false, from: '09:00', to: '18:00' },
  },
};

describe('business hours draft', () => {
  it('starts from the schedule as saved, without sharing objects with it', () => {
    const draft = draftFrom(hours);
    expect(draft.timezone).toBe('Asia/Kolkata');
    expect(draft.days.sat).toEqual({ enabled: false, from: '09:00', to: '18:00' });
    draft.days.sat.enabled = true;
    expect(hours.days.sat.enabled).toBe(false);
  });

  it('has no problems for a valid schedule', () => {
    expect(checkDraft(draftFrom(hours))).toEqual({});
  });

  it('flags an empty time as required and a closing time not after opening as order', () => {
    const draft = draftFrom(hours);
    draft.days.wed.to = '';
    draft.days.thu = { enabled: true, from: '18:00', to: '09:00' };
    draft.days.fri = { enabled: false, from: '10:00', to: '10:00' };
    expect(checkDraft(draft)).toEqual({ wed: 'required', thu: 'order', fri: 'order' });
  });

  it('keeps a switched-off day in the check, as the server does', () => {
    const draft = draftFrom(hours);
    draft.days.sun = { enabled: false, from: '20:00', to: '08:00' };
    expect(checkDraft(draft)).toEqual({ sun: 'order' });
  });
});

describe('save body', () => {
  it('sends the zone and all seven days to the owner', () => {
    const body = toUpdateInput(draftFrom(hours), true);
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(Object.keys(body.days)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('leaves the zone out for anyone who may not change it', () => {
    const body = toUpdateInput(draftFrom(hours), false);
    expect(body).not.toHaveProperty('timezone');
    expect(Object.keys(body.days)).toHaveLength(7);
  });
});
