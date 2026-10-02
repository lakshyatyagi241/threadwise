import { describe, expect, it } from 'vitest';
import {
  eventsHref,
  filtersFromParams,
  hasFilters,
  parseStatus,
  prettyPayload,
  securityTrailHref,
  statusTone,
} from './events';

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

describe('securityTrailHref', () => {
  it('searches the viewer for the platform.security events', () => {
    expect(securityTrailHref()).toBe('/admin/security/events?q=platform.security');
  });
  it('keeps both the exact name and the text search when given together', () => {
    expect(eventsHref({ event: 'auth.failed', q: ' lock ', status: 'failure' })).toBe(
      '/admin/security/events?event=auth.failed&q=lock&status=failure',
    );
  });
});

describe('prettyPayload', () => {
  it('indents JSON and reports an empty payload as null', () => {
    expect(prettyPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyPayload({})).toBeNull();
  });
});

describe('filtersFromParams', () => {
  it('reads the three filters from a query string', () => {
    const p = new URLSearchParams('event=auth.failed&q=lock&status=failure');
    expect(filtersFromParams(p)).toEqual({ event: 'auth.failed', q: 'lock', status: 'failure' });
  });
  it('trims, drops blanks and ignores an unknown status', () => {
    const p = new URLSearchParams('event=%20&q=%20x%20&status=bogus');
    expect(filtersFromParams(p)).toEqual({ event: undefined, q: 'x', status: undefined });
  });
  it('round-trips through eventsHref', () => {
    const filters = { event: 'auth.failed', q: 'a b', status: 'warning' as const };
    const query = eventsHref(filters).split('?')[1]!;
    expect(filtersFromParams(new URLSearchParams(query))).toEqual(filters);
  });
});

describe('hasFilters', () => {
  it('is true when any filter is set', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ event: 'x' })).toBe(true);
    expect(hasFilters({ q: 'x' })).toBe(true);
    expect(hasFilters({ status: 'info' })).toBe(true);
  });
});
