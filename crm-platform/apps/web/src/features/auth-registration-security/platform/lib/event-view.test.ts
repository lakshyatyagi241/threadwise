import { describe, expect, it } from 'vitest';
import { eventActor, eventOrg, shortId } from './event-view';

describe('shortId', () => {
  it('keeps the first eight characters and marks the cut', () => {
    expect(shortId('3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b')).toBe('3f2b8c1e…');
  });
  it('leaves a short id alone', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('12345678')).toBe('12345678');
    expect(shortId('123456789')).toBe('123456789');
  });
  it('cuts by characters, not UTF-16 units', () => {
    expect(shortId('😀😀😀😀😀😀😀😀😀😀')).toBe('😀😀😀😀😀😀😀😀…');
  });
});

describe('eventActor', () => {
  const base = { actorType: 'user', actorId: 'id-1', actorName: 'Ann Lee', actorEmail: 'ann@x.io' };
  it('shows the name with the email beside it', () => {
    expect(eventActor(base)).toEqual({
      label: 'Ann Lee',
      email: 'ann@x.io',
      id: 'id-1',
      type: 'user',
    });
  });
  it('falls back to the email when there is no name', () => {
    expect(eventActor({ ...base, actorName: ' ' })).toMatchObject({
      label: 'ann@x.io',
      email: null,
    });
  });
  it('has no label for a system event or a deleted account', () => {
    expect(
      eventActor({ actorType: 'system', actorId: null, actorName: null, actorEmail: null }),
    ).toEqual({ label: null, email: null, id: null, type: 'system' });
  });
});

describe('eventOrg', () => {
  const id = '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b';
  it('is null for an event without a workspace', () => {
    expect(eventOrg({ orgId: null, orgSlug: null, orgName: null })).toBeNull();
  });
  it('shows the name with the slug beside it', () => {
    expect(eventOrg({ orgId: id, orgSlug: 'acme', orgName: 'Acme Ltd' })).toEqual({
      label: 'Acme Ltd',
      slug: 'acme',
      id,
    });
  });
  it('falls back to the slug, then to the shortened uuid', () => {
    expect(eventOrg({ orgId: id, orgSlug: 'acme', orgName: null })).toEqual({
      label: 'acme',
      slug: null,
      id,
    });
    expect(eventOrg({ orgId: id, orgSlug: null, orgName: ' ' })).toEqual({
      label: '3f2b8c1e…',
      slug: null,
      id,
    });
  });
});
