import { describe, expect, it } from 'vitest';
import { widgetLauncherSchema } from '@crm/contracts';
import {
  launcherPayload,
  newState,
  previewLauncher,
  previewSource,
  previewWhatsappLink,
  wizardLauncher,
  toPayload,
  validateWhatsapp,
  validSpacing,
  type BuilderState,
} from './builder-model';
import { previewDocument } from './launcher-preview-doc';

/** TW-WGT-028: the WhatsApp widget page's model (user-requested Interakt reference). */

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
      botName: '',
      subHeader: 'Typically replies within 5 mins',
      ctaText: 'Start Conversation',
      popup: {
        enabled: false,
        position: 'top',
        style: 'bubble',
        text: 'Hi! May I assist you?',
        image: '',
      },
      animation: 'none',
      badge: true,
      chat: {
        fill: 'outline',
        shape: 'pill',
        font: 'system',
        size: 'standard',
        header: 'diagonal',
        direction: 'auto',
        icons: true,
        suggestions: [],
        suggestionNodes: [],
        suggestionsOn: true,
        actions: true,
        expand: true,
        voice: false,
        logo: '',
        avatar: '',
        background: '',
        corner: 'rounded',
        autoOpen: 0,
        sound: false,
        notice: { enabled: false, icon: 1, items: [] },
        quickMenu: { enabled: false, view: 'list', items: [] },
        banners: { enabled: false, items: [] },
        fontSize: 14,
        hoverBg: '',
        soundVolume: 70,
        speak: false,
        pip: false,
        devices: { desktop: true, tablet: true, mobile: true },
      },
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

describe('the button options of a WhatsApp bot', () => {
  const launcherOf = (patch: Partial<BuilderState['launcher']>): BuilderState =>
    ready({ launcher: { ...newState().launcher, ...patch } });

  it('needs the button text', () => {
    const p = validateWhatsapp(launcherOf({ ctaText: '  ' }));
    expect(p).toMatchObject({ ok: false, key: 'cta', card: 3, field: 'ctaText' });
  });

  it('needs the popup text only while the popup is on', () => {
    const popup = {
      enabled: true,
      position: 'top' as const,
      style: 'bubble' as const,
      text: ' ',
      image: '',
    };
    expect(validateWhatsapp(launcherOf({ popup }))).toMatchObject({
      ok: false,
      key: 'popupText',
      card: 6,
      field: 'popupText',
    });
    expect(validateWhatsapp(launcherOf({ popup: { ...popup, enabled: false } })).ok).toBe(true);
  });

  it('refuses a popup image that is not an image address', () => {
    const popup = {
      enabled: false,
      position: 'top' as const,
      style: 'bubble' as const,
      text: 'Hi',
      image: 'javascript:alert(1)',
    };
    expect(validateWhatsapp(launcherOf({ popup }))).toMatchObject({
      ok: false,
      key: 'popupImage',
      card: 6,
    });
  });

  it("a bot's button needs the message a tap sends, and does not ask for a number", () => {
    const noMessage = ready({
      prefilledMessage: ' ',
      targetWhatsappCc: '',
      targetWhatsappNumber: '',
    });
    expect(validateWhatsapp(noMessage, { bot: true })).toMatchObject({
      ok: false,
      key: 'prefilled',
      card: 3,
      field: 'prefilledMessage',
    });
    const noNumber = ready({
      prefilledMessage: 'join',
      targetWhatsappCc: '',
      targetWhatsappNumber: '',
    });
    expect(validateWhatsapp(noNumber, { bot: true }).ok).toBe(true);
    // The Chat widget page still wants the number.
    expect(validateWhatsapp(noNumber)).toMatchObject({ ok: false, key: 'whatsapp' });
  });

  it('the payload carries every new option through the contract', () => {
    const state = launcherOf({
      botName: ' Acme help ',
      subHeader: 'We reply fast',
      ctaText: 'Chat now',
      popup: {
        enabled: true,
        position: 'side',
        style: 'bubble',
        text: ' Need a hand? ',
        image: '',
      },
      animation: 'ripple',
    });
    const p = launcherPayload(state.launcher);
    expect(p).toMatchObject({
      botName: 'Acme help',
      subHeader: 'We reply fast',
      ctaText: 'Chat now',
      popup: { enabled: true, position: 'side', style: 'bubble', text: 'Need a hand?' },
      animation: 'ripple',
    });
    expect(widgetLauncherSchema.safeParse(p).success).toBe(true);
  });

  it('the preview never breaks on an empty button text', () => {
    const preview = previewLauncher(launcherOf({ ctaText: '' }).launcher);
    expect(preview.ctaText).toBe('Start Conversation');
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

describe('one preview for every engine', () => {
  const wizard = (over: Partial<BuilderState> = {}): BuilderState => ({
    ...newState(),
    mode: 'both',
    name: 'Acme',
    assistantId: 'a-1',
    targetWhatsappCc: '+91',
    targetWhatsappNumber: '9876543210',
    ...over,
  });

  it('Smart agent and Smart + WhatsApp fill the same panel from the wizard: name, opening line, header colour, image, side', () => {
    const src = previewSource(
      wizard({
        name: 'Test By JD',
        welcomeMessage: 'Welcome in',
        headerBg: '#112233',
        buttonImageUrl: 'https://cdn.example/logo.png',
        position: 'bottom_left',
      }),
      'Your business',
    );
    expect(src.name).toBe('Test By JD');
    expect(src.launcher).toMatchObject({
      colour: '#112233',
      avatar: 'https://cdn.example/logo.png',
      greeting: '',
      introMessage: 'Welcome in',
      desktop: { side: 'left' },
      mobile: { side: 'left' },
    });
  });

  it('a header colour that is not a hex falls back to the launcher fill, then to the original green; an odd image to the default', () => {
    expect(wizardLauncher(wizard({ headerBg: 'red', buttonColor: '#336699' })).colour).toBe(
      '#336699',
    );
    expect(wizardLauncher(wizard({ headerBg: 'red', buttonColor: 'blue' })).colour).toBe(
      'original',
    );
    expect(wizardLauncher(wizard({ buttonImageUrl: 'javascript:alert(1)' })).avatar).toBe(
      'preset:support',
    );
    expect(wizardLauncher(wizard({ welcomeMessage: '  ' })).introMessage).toContain(
      'We are here to help',
    );
  });

  it('Both opens WhatsApp with the number and the pre-typed message; Smart agent has no link and its button is inert, not disabled', () => {
    const both = previewSource(wizard({ prefilledMessage: 'Hello there' }), 'x');
    expect(both.whatsappUrl).toBe('https://wa.me/919876543210?text=Hello+there');
    expect(both.inertStart).toBe(false);
    const ai = previewSource(wizard({ mode: 'ai' }), 'x');
    expect(ai.whatsappUrl).toBeNull();
    expect(ai.inertStart).toBe(true);
  });

  it('the WhatsApp page keeps its own options as the source', () => {
    const src = previewSource(ready({ name: '' }), 'Your business');
    expect(src.name).toBe('Your business');
    expect(src.launcher.greeting).toBe('HI THERE!');
    expect(src.inertStart).toBe(false);
  });

  it('the document is the open panel for every engine, pinned to the device', () => {
    for (const s of [wizard(), wizard({ mode: 'ai' }), ready()]) {
      const doc = previewDocument({ ...previewSource(s, 'x'), device: 'mobile', startOpen: true });
      expect(doc).toContain('"startOpen":true');
      expect(doc).toContain('"device":"mobile"');
      expect(doc).toContain('Start Conversation');
    }
  });
});

describe('cleanChat: what the conversation tools send', () => {
  it('leaves out items still being typed and blank lines, and keeps complete ones', async () => {
    const { cleanChat, launcherDraft } = await import('./builder-model');
    const { DEFAULT_LAUNCHER } = await import('@crm/contracts');
    const base = launcherDraft(DEFAULT_LAUNCHER).chat;
    const out = cleanChat({
      ...base,
      suggestions: ['  Hi  ', ' '],
      notice: {
        enabled: true,
        icon: 1,
        items: [
          {
            image: '',
            title: 'Sale',
            description: 'Ends Friday',
            buttonTitle: '',
            buttonUrl: '',
            footer: '',
          },
          { image: '', title: '', description: '', buttonTitle: '', buttonUrl: '', footer: '' },
        ],
      },
      quickMenu: {
        enabled: true,
        view: 'list',
        items: [
          { image: '', title: '', url: '', node: '' },
          { image: '', title: 'Track', url: '', node: '' },
        ],
      },
      banners: {
        enabled: true,
        items: [
          { kind: 'image', image: '', video: '', url: '', node: '' },
          { kind: 'video', image: '', video: 'https://www.youtube.com/embed/dQw4w9WgXcQ', url: '', node: '' },
        ],
      },
    });
    expect(out.suggestions).toEqual(['Hi']);
    expect(out.notice.items).toHaveLength(1);
    expect(out.quickMenu.items.map((i) => i.title)).toEqual(['Track']);
    expect(out.banners.items).toHaveLength(1);
  });
});
