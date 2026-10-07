import { describe, expect, it } from 'vitest';
import { unofficialSwitchState } from '../use-unofficial-switch';
import { ENABLE_PHRASE, phraseOk, unofficialView } from './unofficial';

describe('unofficial WhatsApp switch view', () => {
  it('off is the default state: neutral-supported badge, rest of the page dimmed, the button turns it on', () => {
    expect(unofficialView(false)).toEqual({
      status: 'disabled',
      tone: 'success',
      dimRest: true,
      next: true,
    });
  });

  it('on is the warned state: nothing dimmed, the button turns it off', () => {
    expect(unofficialView(true)).toEqual({
      status: 'enabled',
      tone: 'warning',
      dimRest: false,
      next: false,
    });
  });

  it('turning it on needs the typed word, ignoring case and surrounding spaces', () => {
    expect(ENABLE_PHRASE).toBe('ENABLE');
    expect(phraseOk('ENABLE')).toBe(true);
    expect(phraseOk('  enable ')).toBe(true);
    expect(phraseOk('enabl')).toBe(false);
    expect(phraseOk('')).toBe(false);
    expect(phraseOk('disable')).toBe(false);
  });

  it('reads the switch from the Node bridge payload; no payload or an older API is unknown', () => {
    expect(unofficialSwitchState({ unofficialEnabled: true })).toBe('on');
    expect(unofficialSwitchState({ unofficialEnabled: false })).toBe('off');
    expect(unofficialSwitchState({})).toBe('unknown');
    expect(unofficialSwitchState(undefined)).toBe('unknown');
  });
});
