import { describe, expect, it } from 'vitest';
import { widgetLauncherSchema } from '@crm/contracts';
import {
  launcherPayload,
  newState,
  previewLauncher,
  previewWhatsappLink,
  toPayload,
  validateWhatsapp,
  validSpacing,
  type BuilderState,
} from './builder-model';
import { previewDocument } from './launcher-preview-doc';

/** WD-WGT-028: the WhatsApp widget page's model (user-requested Interakt reference). */

const ready = (over: Partial<BuilderState> = {}): BuilderState => ({
  ...newState(),
  mode: 'whatsapp',
  name: 'Acme',
  targetWhatsappCc: '+91',
  targetWhatsappNumber: '9876543210',
  ...over,
});
const withLauncher = (patch: Partial<BuilderState['launcher']>): BuilderState => {
  const s = ready();
  return { ...s, launcher: { ...s.launcher, ...patch } };
};

describe('the launcher draft', () => {
  it('a new widget opens on the Interakt defaults, spacing held as text', () => {
    expect(newState().launcher).toEqual({
      buttonType: 'pill',
      colour: 'original',
      avatar: 'preset:support',
      greeting: 'HI THERE!',
      introMessage: 'We are here to help you! Chat with us on WhatsApp for any queries.',
      desktop: { side: 'right', sideSpacing: '10', bottomSpacing: '10' },
      mobile: { side: 'right', sideSpacing: '10', bottomSpacing: '60' },
    });
  });

  it('the payload turns spacing into whole numbers and passes the contract', () => {
    const p = launcherPayload({
      ...newState().launcher,
      desktop: { side: 'left', sideSpacing: ' 24 ', bottomSpacing: '0' },
    });
    expect(p.desktop).toEqual({ side: 'left', sideSpacing: 24, bottomSpacing: 0 });
    expect(widgetLauncherSchema.safeParse(p).success).toBe(true);
  });

  it('spacing that is not a whole number becomes NaN, which the contract refuses', () => {
    for (const bad of ['', '-1', '1.5', 'ten', '1e3', '12345']) {
      const p = launcherPayload({
        ...newState().launcher,
        mobile: { side: 'right', sideSpacing: bad, bottomSpacing: '60' },
      });
      expect(widgetLauncherSchema.safeParse(p).success, bad).toBe(false);
    }
  });

  it('a WhatsApp widget is placed and filled by its launcher: the legacy side and colour follow it', () => {
    const left = toPayload(
      withLauncher({
        colour: 'blue-lagoon',
        desktop: { side: 'left', sideSpacing: '10', bottomSpacing: '10' },
      }),
    );
    expect(left.position).toBe('bottom_left');
    expect(left.buttonColor).toBe('#38BDF8');
    expect(left.launcher?.colour).toBe('blue-lagoon');
    // the other engines keep the wizard's own fields
    const ai = toPayload({
      ...ready({ mode: 'ai', position: 'bottom_left', buttonColor: '#112233' }),
    });
    expect(ai.position).toBe('bottom_left');
    expect(ai.buttonColor).toBe('#112233');
    expect(ai.launcher).toBeDefined();
  });
});

describe('spacing rule', () => {
  it.each([
    ['0', true],
    ['10', true],
    ['500', true],
    ['501', false],
    ['-1', false],
    ['1.5', false],
    ['', false],
    ['abc', false],
  ])('%j is %s', (v, ok) => {
    expect(validSpacing(v)).toBe(ok);
  });
});

describe('Save Changes rules, in the order the page reads', () => {
  it('a finished page passes', () => {
    expect(validateWhatsapp(ready())).toEqual({ ok: true });
  });

  it('the name comes first and flashes the name field above the cards', () => {
    expect(validateWhatsapp(ready({ name: '  ' }))).toEqual({
      ok: false,
      key: 'name',
      card: 0,
      field: 'name',
    });
  });

  it('a bad image address opens card 2', () => {
    expect(validateWhatsapp(withLauncher({ avatar: 'javascript:alert(1)' }))).toMatchObject({
      ok: false,
      key: 'avatar',
      card: 2,
      field: 'avatar',
    });
  });

  it('an empty greeting or intro opens card 3 at the right field', () => {
    expect(validateWhatsapp(withLauncher({ greeting: ' ' }))).toMatchObject({
      key: 'greeting',
      card: 3,
      field: 'greeting',
    });
    expect(validateWhatsapp(withLauncher({ introMessage: '' }))).toMatchObject({
      key: 'intro',
      card: 3,
      field: 'introMessage',
    });
  });

  it('each of the four spacing boxes is checked and opens card 4', () => {
    const base = newState().launcher;
    const cases = [
      [{ desktop: { ...base.desktop, sideSpacing: '-5' } }, 'desktopSideSpacing'],
      [{ desktop: { ...base.desktop, bottomSpacing: 'x' } }, 'desktopBottomSpacing'],
      [{ mobile: { ...base.mobile, sideSpacing: '501' } }, 'mobileSideSpacing'],
      [{ mobile: { ...base.mobile, bottomSpacing: '' } }, 'mobileBottomSpacing'],
    ] as const;
    for (const [patch, field] of cases) {
      expect(validateWhatsapp(withLauncher(patch))).toMatchObject({
        ok: false,
        key: 'spacing',
        card: 4,
        field,
      });
    }
  });

  it('fewer than eight digits of number opens card 5 on the phone box', () => {
    expect(validateWhatsapp(ready({ targetWhatsappNumber: '12' }))).toMatchObject({
      ok: false,
      key: 'whatsapp',
      card: 5,
      field: 'phone',
    });
    expect(
      validateWhatsapp(ready({ targetWhatsappCc: '', targetWhatsappNumber: '' })),
    ).toMatchObject({
      key: 'whatsapp',
    });
  });

  it('the first failing rule wins when several fail', () => {
    const s = withLauncher({ greeting: '' });
    expect(validateWhatsapp({ ...s, targetWhatsappNumber: '1' })).toMatchObject({
      key: 'greeting',
    });
  });
});

describe('the preview', () => {
  it('opens WhatsApp with the number and the pre-filled message as they are typed', () => {
    expect(previewWhatsappLink(ready({ prefilledMessage: 'Hello there' }))).toBe(
      'https://wa.me/919876543210?text=Hello+there',
    );
    expect(
      previewWhatsappLink(ready({ targetWhatsappNumber: '', targetWhatsappCc: '' })),
    ).toBeNull();
  });

  it('half-typed values never break it: bad spacing and empty texts fall back to the defaults', () => {
    const p = previewLauncher({
      ...newState().launcher,
      greeting: '',
      avatar: 'junk',
      desktop: { side: 'left', sideSpacing: '', bottomSpacing: '9999' },
    });
    expect(p.greeting).toBe('HI THERE!');
    expect(p.avatar).toBe('preset:support');
    expect(p.desktop).toEqual({ side: 'left', sideSpacing: 10, bottomSpacing: 500 });
  });

  it('the frame document holds the real script, pinned to the chosen device, and no script ending in saved text', () => {
    const doc = previewDocument({
      name: '</script><b>x</b>',
      launcher: previewLauncher(newState().launcher),
      whatsappUrl: 'https://wa.me/1',
      device: 'mobile',
      startOpen: true,
    });
    expect(doc).toContain('"device":"mobile"');
    expect(doc).toContain('"preview":true');
    expect(doc).toContain('"startOpen":true');
    expect(doc).toContain('Start Conversation');
    // exactly one script element, closed once
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('the preview backdrop', () => {
  it('is a clean neutral page with the panel dominating: no skeleton blocks', () => {
    const doc = previewDocument({
      name: 'Acme',
      launcher: previewLauncher(newState().launcher),
      whatsappUrl: null,
      device: 'desktop',
      startOpen: true,
    });
    expect(doc).not.toContain('class="hero"');
    expect(doc).not.toContain('class="line');
    expect(doc).toContain('"startOpen":true');
  });
});
