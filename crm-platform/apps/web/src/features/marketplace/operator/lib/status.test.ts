import { describe, expect, it } from 'vitest';
import {
  MARKET_APP_STATUSES,
  MARKET_HEALTH_STATES,
  MARKET_REQUEST_STATUSES,
  MARKET_VERSION_STATUSES,
} from '@crm/contracts';
import {
  APP_STATUS_TONE,
  HEALTH_TONE,
  REQUEST_STATUS_TONE,
  VERSION_STATUS_TONE,
  appStatusTone,
  requestStatusTone,
  versionStatusTone,
} from './status';

const TONES = ['neutral', 'success', 'warning', 'danger'];

describe('status chips', () => {
  it('every status of every kind has a tone the Badge knows', () => {
    for (const s of MARKET_APP_STATUSES) expect(TONES).toContain(appStatusTone(s));
    for (const s of MARKET_VERSION_STATUSES) expect(TONES).toContain(versionStatusTone(s));
    for (const s of MARKET_REQUEST_STATUSES) expect(TONES).toContain(requestStatusTone(s));
    for (const s of MARKET_HEALTH_STATES) expect(TONES).toContain(HEALTH_TONE[s]);
    expect(Object.keys(APP_STATUS_TONE).sort()).toEqual([...MARKET_APP_STATUSES].sort());
    expect(Object.keys(VERSION_STATUS_TONE).sort()).toEqual([...MARKET_VERSION_STATUSES].sort());
    expect(Object.keys(REQUEST_STATUS_TONE).sort()).toEqual([...MARKET_REQUEST_STATUSES].sort());
  });

  it('the live state is green, the emergency stop is red, and what waits for a decision is amber', () => {
    expect(appStatusTone('published')).toBe('success');
    expect(appStatusTone('killed')).toBe('danger');
    expect(appStatusTone('in_review')).toBe('warning');
    expect(appStatusTone('draft')).toBe('neutral');
    expect(versionStatusTone('rejected')).toBe('danger');
    expect(versionStatusTone('in_review')).toBe('warning');
    expect(versionStatusTone('approved')).toBe('success');
    expect(versionStatusTone('retired')).toBe('neutral');
    expect(requestStatusTone('shipped')).toBe('success');
    expect(requestStatusTone('declined')).toBe('danger');
  });
});
