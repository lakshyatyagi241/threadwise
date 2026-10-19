import { describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import {
  countryOfPhone,
  jobTitleEditable,
  jobTitleField,
  jobTitleOf,
  networkOf,
  socialLinks,
  timeZoneOf,
  webUrl,
} from './contact-overview';

const field = (over: Partial<FieldResponse>) =>
  ({ isActive: true, isSystem: false, ...over }) as FieldResponse;

describe('social links', () => {
  it('names the network a property key stands for', () => {
    expect(networkOf('linkedin')).toBe('linkedin');
    expect(networkOf('LinkedIn_URL')).toBe('linkedin');
    expect(networkOf('x_profile')).toBe('twitter');
    expect(networkOf('twitter')).toBe('twitter');
    expect(networkOf('facebook_page')).toBe('facebook');
    expect(networkOf('city')).toBeNull();
    expect(networkOf('linkedin_connections')).toBeNull();
  });

  it('accepts only http(s) addresses', () => {
    expect(webUrl('https://linkedin.com/in/ana')).toBe('https://linkedin.com/in/ana');
    expect(webUrl('linkedin.com/in/ana')).toBe('https://linkedin.com/in/ana');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '',
      '   ',
      5,
      null,
      'ftp://x.test',
    ]) {
      expect(webUrl(bad), String(bad)).toBeNull();
    }
  });

  it('collects one link per network in a fixed order and skips bad values', () => {
    const links = socialLinks({
      linkedin_url: 'https://linkedin.com/in/ana',
      facebook: 'facebook.com/ana',
      x: 'javascript:alert(1)',
      twitter: 'https://x.com/ana',
      city: 'Pune',
    });
    expect(links.map((l) => l.network)).toEqual(['facebook', 'linkedin', 'twitter']);
    expect(socialLinks({})).toEqual([]);
  });
});

describe('job title', () => {
  it('uses the first usual key that is an active, non-system property', () => {
    expect(jobTitleField([field({ key: 'designation' }), field({ key: 'job_title' })])?.key).toBe(
      'job_title',
    );
    expect(jobTitleField([field({ key: 'job_title', isActive: false })])).toBeNull();
    expect(jobTitleField([field({ key: 'job_title', isSystem: true })])).toBeNull();
    expect(jobTitleField(undefined)).toBeNull();
    expect(jobTitleField([field({ key: 'job_title', isHidden: true })])).toBeNull();
  });

  it('is editable unless the property is read-only or a formula (the API refuses those)', () => {
    expect(jobTitleEditable(field({ key: 'job_title' }))).toBe(true);
    expect(jobTitleEditable(field({ key: 'job_title', isReadOnly: true }))).toBe(false);
    expect(jobTitleEditable(field({ key: 'job_title', fieldType: 'formula' }))).toBe(false);
    expect(jobTitleEditable(null)).toBe(false);
  });
  it('reads its text', () => {
    const f = field({ key: 'job_title' });
    expect(jobTitleOf({ customFields: { job_title: ' CTO ' } }, f)).toBe('CTO');
    expect(jobTitleOf({ customFields: { job_title: 7 } }, f)).toBe('');
    expect(jobTitleOf({ customFields: {} }, null)).toBe('');
  });
});

describe('location', () => {
  it('names the country of a valid number in the viewer language', () => {
    expect(countryOfPhone('+919876543210', 'en')).toBe('India');
    expect(countryOfPhone('+14155552671', 'en')).toBe('United States');
    expect(countryOfPhone('12345', 'en')).toBe('');
    expect(countryOfPhone(null, 'en')).toBe('');
  });

  it('reads the time zone from the workspace property of that type, else a property named timezone', () => {
    const typed = [field({ key: 'tz', fieldType: 'timezone' })];
    expect(timeZoneOf({ customFields: { tz: 'Asia/Kolkata' } }, typed)).toBe('Asia/Kolkata');
    expect(timeZoneOf({ customFields: { timezone: 'Europe/Berlin' } }, undefined)).toBe(
      'Europe/Berlin',
    );
    expect(timeZoneOf({ customFields: {} }, typed)).toBe('');
  });
});
