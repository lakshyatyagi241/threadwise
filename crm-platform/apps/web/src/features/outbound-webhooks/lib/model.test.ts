import { describe, expect, it } from 'vitest';
import { eventsForSave, healthOf, shortUrl, urlProblem } from './model';

const ALL = ['contact_created', 'task_created', 'deal_stage_changed'];

describe('eventsForSave', () => {
  it('none or * is *; every event picked is *; otherwise the pick', () => {
    expect(eventsForSave([], ALL)).toEqual(['*']);
    expect(eventsForSave(['task_created', '*'], ALL)).toEqual(['*']);
    expect(eventsForSave([...ALL], ALL)).toEqual(['*']);
    expect(eventsForSave(['task_created'], ALL)).toEqual(['task_created']);
  });
});

describe('urlProblem', () => {
  it('names what is wrong, and accepts an https address', () => {
    expect(urlProblem('')).toBe('empty');
    expect(urlProblem('   ')).toBe('empty');
    expect(urlProblem('nope')).toBe('invalid');
    expect(urlProblem('http://example.com/x')).toBe('notHttps');
    expect(urlProblem(`https://example.com/${'a'.repeat(2050)}`)).toBe('tooLong');
    expect(urlProblem('https://example.com/hook')).toBeNull();
  });
});

describe('shortUrl', () => {
  it('keeps the host and hides most of a long path (it may carry a token)', () => {
    expect(shortUrl('https://example.com/')).toBe('example.com');
    expect(shortUrl('https://example.com/in')).toBe('example.com/in');
    expect(shortUrl('https://example.com/hooks/abcdef1234567890secret')).toBe(
      'example.com/hooks/abcdef1…',
    );
    expect(shortUrl('not a url')).toBe('not a url');
  });
});

describe('healthOf', () => {
  const w = { active: true, isFailing: false, successCount: 0, failureCount: 0 };
  it('off beats failing beats healthy; no deliveries is idle', () => {
    expect(healthOf({ ...w, active: false, isFailing: true })).toBe('off');
    expect(healthOf({ ...w, isFailing: true })).toBe('failing');
    expect(healthOf({ ...w, successCount: 3 })).toBe('healthy');
    expect(healthOf(w)).toBe('idle');
  });
});
