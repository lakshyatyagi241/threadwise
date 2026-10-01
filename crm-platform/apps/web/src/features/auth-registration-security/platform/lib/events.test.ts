import { describe, expect, it } from 'vitest';
import { eventsHref, parseStatus, prettyPayload, statusTone } from './events';

describe('parseStatus', () => {
  it('accepts the four statuses only', () => {
    expect(parseStatus('failure')).toBe('failure');
    expect(parseStatus('success')).toBe('success');
    expect(parseStatus('bogus')).toBeUndefined();
    expect(parseStatus('')).toBeUndefined();
    expect(parseStatus(null)).toBeUndefined();
  });
});

describe('statusTone', () => {
  it('colours failures red and warnings amber', () => {
    expect(statusTone('failure')).toBe('danger');
    expect(statusTone('warning')).toBe('warning');
    expect(statusTone('success')).toBe('success');
    expect(statusTone('info')).toBe('neutral');
  });
});

describe('eventsHref', () => {
  it('builds the viewer link with only the filters that are set', () => {
    expect(eventsHref({})).toBe('/admin/security/events');
    expect(eventsHref({ event: 'auth.failed' })).toBe('/admin/security/events?event=auth.failed');
    expect(eventsHref({ event: ' auth.lockout ', status: 'warning' })).toBe(
      '/admin/security/events?event=auth.lockout&status=warning',
    );
    expect(eventsHref({ event: '  ' })).toBe('/admin/security/events');
  });
});

describe('prettyPayload', () => {
  it('indents JSON and reports an empty payload as null', () => {
    expect(prettyPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyPayload({})).toBeNull();
  });
});
