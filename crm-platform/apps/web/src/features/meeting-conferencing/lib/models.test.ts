import { describe, expect, it } from 'vitest';
import type { ConferencingCapabilities, ContactMeetingResponse } from '@crm/contracts';
import {
  connectLinkOf,
  inputOf,
  MARKETPLACE_INTEGRATIONS,
  optionsFor,
  toggleProvider,
  VIDEO_MEETINGS_PATH,
} from './form-model';
import { readOutcome, safeConsentUrl, withoutOutcome } from './screen-model';
import { safeHref } from './status-model';

const caps = (over: Partial<ConferencingCapabilities> = {}): ConferencingCapabilities => ({
  video: [],
  calendar: null,
  canInstall: false,
  connectable: [],
  installable: false,
  ...over,
});

describe('form model', () => {
  it('links to the connection page when only the person is missing, to the Marketplace when they may install, else nowhere', () => {
    expect(connectLinkOf(caps({ connectable: ['zoom'], canInstall: true, installable: true }))).toBe(VIDEO_MEETINGS_PATH);
    expect(connectLinkOf(caps({ canInstall: true, installable: true }))).toBe(MARKETPLACE_INTEGRATIONS);
    expect(connectLinkOf(caps({ installable: true }))).toBeNull();
    expect(connectLinkOf(caps())).toBeNull();
    expect(connectLinkOf(caps({ video: [{ provider: 'zoom', via: 'app' }], canInstall: true, installable: true }))).toBeNull();
  });

  it('keeps the provider a meeting already holds in the options even when it is no longer connected', () => {
    expect(optionsFor(caps(), 'zoom')).toEqual([{ provider: 'zoom', via: 'app' }]);
    expect(optionsFor(caps({ video: [{ provider: 'zoom', via: 'app' }] }), 'zoom')).toHaveLength(1);
    expect(optionsFor(caps(), null)).toEqual([]);
  });

  it('toggles: the chosen one off, another one replaces it', () => {
    expect(toggleProvider('zoom', 'zoom')).toEqual({ videoProvider: null });
    expect(toggleProvider('zoom', 'teams')).toEqual({ videoProvider: 'teams' });
    expect(toggleProvider(null, 'meet')).toEqual({ videoProvider: 'meet' });
  });

  it('starts an edit from what the meeting already asks for, and from nothing for a plain meeting', () => {
    const m = (c: ContactMeetingResponse['conferencing']) => ({ conferencing: c }) as ContactMeetingResponse;
    expect(inputOf(m(null))).toBeUndefined();
    expect(
      inputOf(
        m({ videoProvider: 'meet', videoStatus: 'ready', videoError: null, calendarProvider: 'google', calendarStatus: 'synced', calendarError: null, invited: true }),
      ),
    ).toEqual({ videoProvider: 'meet', addToCalendar: true, sendInvitation: true });
  });
});

describe('screen model', () => {
  it('reads the outcome and the ticket from the address, and ignores anything else', () => {
    expect(readOutcome('?video=confirm&provider=zoom&ticket=abc')).toEqual({ kind: 'confirm', provider: 'zoom', ticket: 'abc' });
    expect(readOutcome('?video=denied&provider=teams')).toEqual({ kind: 'denied', provider: 'teams' });
    expect(readOutcome('?video=confirm&provider=zoom')).toBeNull();
    expect(readOutcome('?video=denied&provider=skype')).toBeNull();
    expect(readOutcome('?video=hacked&provider=zoom')).toBeNull();
    expect(readOutcome('')).toBeNull();
  });

  it('takes the outcome and the single-use ticket out of the address', () => {
    expect(withoutOutcome('?video=confirm&provider=zoom&ticket=abc&x=1')).toBe('?x=1');
    expect(withoutOutcome('?video=denied&provider=zoom')).toBe('');
  });

  it('follows only http and https consent addresses', () => {
    expect(safeConsentUrl('https://zoom.us/oauth/authorize?x=1')).toBe('https://zoom.us/oauth/authorize?x=1');
    expect(safeConsentUrl('javascript:alert(1)')).toBeNull();
    expect(safeConsentUrl('data:text/html,x')).toBeNull();
  });
});

describe('status model', () => {
  it('links only http and https join addresses', () => {
    expect(safeHref('https://zoom.us/j/1')).toBe('https://zoom.us/j/1');
    expect(safeHref(' http://x.test/a ')).toBe('http://x.test/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
