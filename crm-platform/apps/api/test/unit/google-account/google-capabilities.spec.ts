import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CAPABILITIES,
  GOOGLE_CAPABILITY_SCOPES,
  googleCapabilitiesOf,
  googleCapabilityRestricted,
  googleMissingScopes,
  googleScopesFor,
} from '@crm/contracts';
import { GoogleCalendarClient } from '../../../src/infra/providers/appointments-booking/google-calendar.client';
import {
  deriveStateKey,
  newState,
  signState,
  verifyState,
} from '../../../src/modules/appointments-booking/google-calendar-state';

const A = 'https://www.googleapis.com/auth';
const creds = { clientId: 'cid', clientSecret: 's', redirectUri: 'https://app.test/cb' };

describe('capabilities and their scopes', () => {
  it('asks for identity plus only what was ticked, with no repeats', () => {
    expect(googleScopesFor(['sheets'])).toEqual(['openid', 'email', `${A}/spreadsheets`]);
    expect(googleScopesFor(['calendar', 'calendar'])).toHaveLength(5);
    expect(
      googleScopesFor([...GOOGLE_CAPABILITIES]).filter((s) => s.startsWith('https')).length,
    ).toBe(new Set(Object.values(GOOGLE_CAPABILITY_SCOPES).flat()).size);
  });

  it('never asks for the broad calendar scope, Gmail or Drive write access beyond what Docs needs', () => {
    const all = googleScopesFor([...GOOGLE_CAPABILITIES]);
    expect(all).not.toContain(`${A}/calendar`);
    expect(all.some((s) => /gmail|contacts|admin/.test(s))).toBe(false);
    // Full drive is the one broad scope, and only the Docs capability carries it.
    expect(googleScopesFor(['sheets', 'forms', 'calendar'])).not.toContain(`${A}/drive`);
    expect(googleScopesFor(['docs'])).toContain(`${A}/drive`);
  });

  it('flags the capabilities that need Google restricted-scope verification', () => {
    expect(googleCapabilityRestricted('docs')).toBe(true);
    expect(googleCapabilityRestricted('drive_listing')).toBe(true);
    expect(googleCapabilityRestricted('sheets')).toBe(false);
    expect(googleCapabilityRestricted('calendar')).toBe(false);
    expect(googleCapabilityRestricted('forms')).toBe(false);
  });

  it('reads what a granted scope string covers: all of a capability or none of it', () => {
    const granted = `openid email ${A}/spreadsheets ${A}/calendar.events ${A}/calendar.freebusy`;
    expect(googleCapabilitiesOf(granted)).toEqual(['sheets']);
    expect(googleCapabilitiesOf(`${granted} ${A}/calendar.calendarlist.readonly`)).toEqual([
      'calendar',
      'sheets',
    ]);
    expect(googleCapabilitiesOf(null)).toEqual([]);
    expect(googleCapabilitiesOf('')).toEqual([]);
  });

  it('counts full drive as covering the file list, but not the other way round', () => {
    expect(googleCapabilitiesOf(`${A}/drive`)).toEqual(['drive_listing']);
    expect(googleCapabilitiesOf(`${A}/documents ${A}/drive`)).toEqual(['docs', 'drive_listing']);
    expect(googleCapabilitiesOf(`${A}/drive.metadata.readonly`)).toEqual(['drive_listing']);
    expect(googleCapabilitiesOf(`${A}/documents ${A}/drive.metadata.readonly`)).toEqual([
      'drive_listing',
    ]);
  });

  it('lists what a grant still lacks for the requested capabilities', () => {
    expect(googleMissingScopes(`${A}/spreadsheets`, ['sheets'])).toEqual([]);
    expect(googleMissingScopes(`${A}/spreadsheets`, ['sheets', 'forms'])).toEqual([
      `${A}/forms.body.readonly`,
    ]);
    expect(googleMissingScopes(`${A}/documents`, ['docs'])).toEqual([`${A}/drive`]);
    expect(googleMissingScopes(null, ['calendar'])).toHaveLength(3);
  });
});

describe('the consent URL for incremental authorization', () => {
  it('keeps what the account already granted and points at the connected account', () => {
    const url = new URL(
      new GoogleCalendarClient().authorizeUrl(creds, 'st', ['sheets'], 'ana@example.com'),
    );
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('login_hint')).toBe('ana@example.com');
    expect(url.searchParams.get('scope')).toBe(`openid email ${A}/spreadsheets`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('is a calendar consent when nothing else is asked for, with no login hint', () => {
    const url = new URL(new GoogleCalendarClient().authorizeUrl(creds, 'st'));
    expect(url.searchParams.get('login_hint')).toBeNull();
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(url.searchParams.get('scope')).not.toContain('spreadsheets');
  });
});

describe('the signed state carries the capabilities asked for', () => {
  const key = deriveStateKey(Buffer.alloc(32, 3).toString('base64'));

  it('round-trips them, so the callback checks the grant against what this consent asked', () => {
    const state = newState(
      { orgId: 4, userId: 9, returnTo: '/google-account', capabilities: ['sheets', 'forms'] },
      1_000,
    );
    const checked = verifyState(signState(state, key), key, 2_000);
    expect(checked.ok && checked.state.capabilities).toEqual(['sheets', 'forms']);
  });

  it('reads a state signed before capabilities existed as a calendar consent', () => {
    const old = newState({ orgId: 1, userId: 1, returnTo: '/appointments/settings' }, 0);
    const checked = verifyState(signState(old, key), key, 1);
    expect(checked.ok && checked.state.capabilities).toEqual(['calendar']);
  });
});
