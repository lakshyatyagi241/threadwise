import { describe, expect, it } from 'vitest';
import {
  buildLauncherScript,
  buildWhatsappLink,
  DEFAULT_LAUNCHER,
  LAUNCHER_COLOUR_PRESETS,
  launcherAvatarSrc,
  parseLauncher,
  resolveLauncherColour,
  toPublicLauncher,
  widgetLauncherSchema,
  type LauncherScriptInput,
} from '@crm/contracts';
import { buildEmbedScript } from '../../../src/modules/chatbot-widget/embed-script';
import { whatsappUrl } from '../../../src/modules/chatbot-widget/widget-rules';

/** WD-WGT-028: the launcher config and the script that draws it (user-requested Interakt reference). */

describe('the config shape', () => {
  it('an empty object is the defaults: pill, the original green, HI THERE!, 10/10 on desktop and 10/60 on mobile, both on the right', () => {
    expect(widgetLauncherSchema.parse({})).toEqual({
      buttonType: 'pill',
      colour: 'original',
      avatar: 'preset:support',
      greeting: 'HI THERE!',
      introMessage: 'We are here to help you! Chat with us on WhatsApp for any queries.',
      desktop: { side: 'right', sideSpacing: 10, bottomSpacing: 10 },
      mobile: { side: 'right', sideSpacing: 10, bottomSpacing: 60 },
    });
    expect(DEFAULT_LAUNCHER.mobile.bottomSpacing).toBe(60);
  });

  it('an omitted key takes its default and an unknown key is dropped (a later option does not break an older client)', () => {
    const parsed = widgetLauncherSchema.parse({
      greeting: 'Hi',
      future: 'x',
      desktop: { side: 'left' },
    });
    expect(parsed.greeting).toBe('Hi');
    expect(parsed).not.toHaveProperty('future');
    expect(parsed.desktop).toEqual({ side: 'left', sideSpacing: 10, bottomSpacing: 10 });
  });

  it.each([
    [{ desktop: { sideSpacing: -1 } }, 'negative spacing'],
    [{ desktop: { sideSpacing: 501 } }, 'spacing over the limit'],
    [{ mobile: { bottomSpacing: 1.5 } }, 'fractional spacing'],
    [{ mobile: { bottomSpacing: '10' } }, 'spacing as text'],
    [{ buttonType: 'square' }, 'unknown button type'],
    [{ colour: 'magenta' }, 'unknown colour name'],
    [{ colour: '#12345' }, 'five-digit hex'],
    [{ avatar: 'javascript:alert(1)' }, 'script address as the image'],
    [{ avatar: 'data:image/png;base64,AAAA' }, 'data address as the image'],
    [{ avatar: 'preset:unknown' }, 'unknown built-in image'],
    [{ greeting: '' }, 'empty greeting'],
    [{ greeting: 'g'.repeat(61) }, 'greeting over 60'],
    [{ introMessage: '   ' }, 'blank intro'],
    [{ introMessage: 'i'.repeat(501) }, 'intro over 500'],
  ])('refuses %j (%s)', (input) => {
    expect(widgetLauncherSchema.safeParse(input).success).toBe(false);
  });

  it('accepts the edges: 0 and 500, 3 and 6 digit hex, an https image', () => {
    const ok = widgetLauncherSchema.safeParse({
      colour: '#abc',
      avatar: 'https://cdn.example/logo.png',
      desktop: { sideSpacing: 0, bottomSpacing: 500 },
      greeting: 'g'.repeat(60),
      introMessage: 'i'.repeat(500),
    });
    expect(ok.success).toBe(true);
    expect(widgetLauncherSchema.safeParse({ colour: '#A1B2C3' }).success).toBe(true);
  });

  it('what a row stores reads back with defaults; garbage reads as the defaults', () => {
    expect(parseLauncher({})).toEqual(DEFAULT_LAUNCHER);
    expect(parseLauncher(null)).toEqual(DEFAULT_LAUNCHER);
    expect(parseLauncher({ greeting: 'Stored' }).greeting).toBe('Stored');
    expect(parseLauncher({ greeting: 5 })).toEqual(DEFAULT_LAUNCHER);
    expect(parseLauncher('nope')).toEqual(DEFAULT_LAUNCHER);
  });
});

describe('colours and images', () => {
  it('there are twelve named presets, each with two distinct gradient ends', () => {
    expect(LAUNCHER_COLOUR_PRESETS.map((p) => p.name)).toEqual([
      'The Original',
      'Teal Deal',
      'Green Lime',
      'Blue Lagoon',
      'Red Cherry',
      'Orange Sunset',
      'Yellow Sand',
      'Pink Margarita',
      'Navy Suit',
      'Purple Velvet',
      'Silver Spoon',
      'Dark Night',
    ]);
    for (const p of LAUNCHER_COLOUR_PRESETS) expect(p.from).not.toBe(p.to);
  });

  it('a preset key resolves to its ends; a hex colour to itself and a darker end; anything else to the original', () => {
    expect(resolveLauncherColour('teal-deal')).toEqual({
      key: 'teal-deal',
      from: '#2DD4BF',
      to: '#0F766E',
    });
    const custom = resolveLauncherColour('#336699');
    expect(custom).toMatchObject({ key: null, from: '#336699' });
    expect(custom.to).toBe('#285077');
    expect(resolveLauncherColour('#abc').from).toBe('#AABBCC');
    expect(resolveLauncherColour('red').key).toBe('original');
  });

  it('a built-in image is a data address, an own image its https address, anything else the default image', () => {
    expect(launcherAvatarSrc('preset:store')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(launcherAvatarSrc('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(launcherAvatarSrc('javascript:alert(1)')).toBe(launcherAvatarSrc('preset:support'));
    // nothing in the data address can close an attribute or a script
    expect(launcherAvatarSrc('preset:chat')).not.toMatch(/['"<>]/);
  });

  it('the public shape is snake_case with the colour resolved', () => {
    const p = toPublicLauncher({
      ...DEFAULT_LAUNCHER,
      colour: 'navy-suit',
      desktop: { side: 'left', sideSpacing: 3, bottomSpacing: 4 },
    });
    expect(p.colour).toEqual({ key: 'navy-suit', from: '#3B5BA9', to: '#14213D' });
    expect(p.desktop).toEqual({ side: 'left', side_spacing: 3, bottom_spacing: 4 });
    expect(p.mobile).toEqual({ side: 'right', side_spacing: 10, bottom_spacing: 60 });
  });
});

describe('the WhatsApp link', () => {
  it('is wa.me with the digits of code and number and the message url-encoded', () => {
    expect(buildWhatsappLink('+91', '98765 43210', 'Hi there, I need help')).toBe(
      'https://wa.me/919876543210?text=Hi+there%2C+I+need+help',
    );
  });
  it('has no query without a message and no link without digits', () => {
    expect(buildWhatsappLink('+1', '5551234567', '')).toBe('https://wa.me/15551234567');
    expect(buildWhatsappLink('+1', '5551234567', null)).toBe('https://wa.me/15551234567');
    expect(buildWhatsappLink('', '', 'hi')).toBeNull();
    expect(buildWhatsappLink(null, undefined, 'hi')).toBeNull();
  });
  it('encodes quotes, brackets and non-latin text', () => {
    expect(buildWhatsappLink('+1', '5551234567', `it's (ok) é`)).toBe(
      'https://wa.me/15551234567?text=it%27s+%28ok%29+%C3%A9',
    );
  });
  it('the API rule builds the same link, and only where the mode and number allow it', () => {
    const base = {
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      prefilledMessage: 'Hello',
    };
    expect(whatsappUrl({ ...base, mode: 'whatsapp' })).toBe(
      'https://wa.me/919876543210?text=Hello',
    );
    expect(whatsappUrl({ ...base, mode: 'both' })).toBe('https://wa.me/919876543210?text=Hello');
    expect(whatsappUrl({ ...base, mode: 'ai' })).toBeNull();
    expect(whatsappUrl({ ...base, mode: 'whatsapp', targetWhatsappNumber: null })).toBeNull();
  });
});

// --- the script, against a tiny fake DOM ----------------------------------------------------------------------------------

interface FakeEl {
  tag: string;
  id: string;
  style: Record<string, string> & { cssText: string };
  attrs: Record<string, string>;
  children: FakeEl[];
  listeners: Record<string, Array<(e?: unknown) => void>>;
  textContent: string;
  innerHTML: string;
  className: string;
  disabled: boolean;
  title: string;
  src: string;
  alt: string;
  type: string;
  setAttribute(k: string, v: string): void;
  appendChild(c: FakeEl): void;
  addEventListener(e: string, f: (e?: unknown) => void): void;
  focus(): void;
}

function runLauncher(input: Partial<LauncherScriptInput> = {}, opts: { mobile?: boolean } = {}) {
  const created: FakeEl[] = [];
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const messages: unknown[] = [];
  const docListeners: Record<string, Array<(e: unknown) => void>> = {};
  const mediaListeners: Array<() => void> = [];
  const mq = {
    matches: opts.mobile === true,
    addEventListener: (_: string, f: () => void) => mediaListeners.push(f),
  };
  const make = (tag: string): FakeEl => {
    const el: FakeEl = {
      tag,
      id: '',
      style: { cssText: '' } as FakeEl['style'],
      attrs: {},
      children: [],
      listeners: {},
      textContent: '',
      innerHTML: '',
      className: '',
      disabled: false,
      title: '',
      src: '',
      alt: '',
      type: '',
      setAttribute(k, v) {
        el.attrs[k] = v;
      },
      appendChild(c) {
        el.children.push(c);
      },
      addEventListener(e, f) {
        (el.listeners[e] ??= []).push(f);
      },
      focus: () => undefined,
    };
    created.push(el);
    return el;
  };
  const head = make('head');
  const body = make('body');
  const doc = {
    head,
    body,
    createElement: make,
    addEventListener: (e: string, f: (e: unknown) => void) => (docListeners[e] ??= []).push(f),
  };
  const win: Record<string, unknown> = {
    open: (url: string, target: string, features: string) => opened.push({ url, target, features }),
    matchMedia: () => mq,
    parent: { postMessage: (m: unknown) => messages.push(m) },
  };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const script = buildLauncherScript({
    id: 'e174adbe-698d-4afd-b89c-2d5cba3a3820',
    name: 'Acme Shop',
    launcher: DEFAULT_LAUNCHER,
    whatsappUrl: 'https://wa.me/919876543210?text=Hi',
    ...input,
  });
  new Function('window', 'document', 'setTimeout', script)(win, doc, (fn: () => void, ms: number) =>
    timers.push({ fn, ms }),
  );
  const byId = (id: string) => created.find((e) => e.id === id)!;
  const click = (el: FakeEl) => el.listeners.click?.forEach((f) => f());
  return {
    created,
    win,
    doc,
    body,
    head,
    opened,
    messages,
    timers,
    docListeners,
    mediaListeners,
    mq,
    byId,
    click,
    script,
  };
}

const run = runLauncher;
const SHORT = 'e174adbe698d';

describe('the loader script', () => {
  it('is a complete program that mounts one wrapper holding the panel, the launcher and the collapse button', () => {
    const r = run();
    const wrap = r.body.children[0]!;
    expect(wrap.className).toBe(`wgt-${SHORT}`);
    expect(wrap.children.map((c) => c.id)).toEqual([
      `wgt-panel-${SHORT}`,
      `wgt-launch-${SHORT}`,
      `wgt-close-${SHORT}`,
    ]);
  });
  it('the pill launcher says Chat With Us; the icon launcher is a round button with no text', () => {
    const pill = run().byId(`wgt-launch-${SHORT}`);
    expect(pill.children.some((c) => c.textContent === 'Chat With Us')).toBe(true);
    expect(pill.style.cssText).toContain('border-radius:27px');
    const icon = run({ launcher: { ...DEFAULT_LAUNCHER, buttonType: 'icon' } }).byId(
      `wgt-launch-${SHORT}`,
    );
    expect(icon.children.some((c) => c.textContent === 'Chat With Us')).toBe(false);
    expect(icon.style.cssText).toContain('width:62px;height:62px');
    expect(icon.style.cssText).toContain('border-radius:50%');
  });

  it('the colour is a gradient of the two ends', () => {
    const r = run({ launcher: { ...DEFAULT_LAUNCHER, colour: 'red-cherry' } });
    expect(r.byId(`wgt-launch-${SHORT}`).style.cssText).toContain(
      'linear-gradient(135deg,#FB7185,#BE123C)',
    );
  });

  it('the placement is written per device from the config: side, side spacing and bottom spacing', () => {
    const r = run({
      launcher: {
        ...DEFAULT_LAUNCHER,
        desktop: { side: 'left', sideSpacing: 24, bottomSpacing: 32 },
        mobile: { side: 'right', sideSpacing: 6, bottomSpacing: 90 },
      },
    });
    const css = r.doc.head.children[0]!.textContent;
    expect(css).toContain(
      `.wgt-${SHORT}[data-dev="d"]{left:24px;right:auto;align-items:flex-start;bottom:32px;--wb:32px}`,
    );
    expect(css).toContain(
      `.wgt-${SHORT}[data-dev="m"]{right:6px;left:auto;align-items:flex-end;bottom:90px;--wb:90px}`,
    );
  });

  it('it follows the window width: mobile under 769 px, desktop above, and it re-checks when the media query changes', () => {
    const desktop = run();
    expect(desktop.body.children[0]!.attrs['data-dev']).toBe('d');
    const mobile = run({}, { mobile: true });
    expect(mobile.body.children[0]!.attrs['data-dev']).toBe('m');
    expect(mobile.mediaListeners).toHaveLength(1);
    mobile.mq.matches = false;
    mobile.mediaListeners[0]!();
    expect(mobile.body.children[0]!.attrs['data-dev']).toBe('d');
  });

  it('the preview pins the device instead of following the window', () => {
    const r = run({ device: 'mobile', preview: true });
    expect(r.body.children[0]!.attrs['data-dev']).toBe('m');
    expect(r.mediaListeners).toHaveLength(0);
  });

  it('the panel starts closed; the launcher opens it and the round button takes the launcher place; the round button closes it', () => {
    const r = run();
    const panel = r.byId(`wgt-panel-${SHORT}`);
    const launch = r.byId(`wgt-launch-${SHORT}`);
    const close = r.byId(`wgt-close-${SHORT}`);
    expect(panel.style.cssText).toContain('display:none');
    r.click(launch);
    expect(panel.style.display).toBe('flex');
    expect(launch.style.display).toBe('none');
    expect(close.style.display).toBe('flex');
    expect(launch.attrs['aria-expanded']).toBe('true');
    r.click(close);
    expect(panel.style.display).toBe('none');
    expect(launch.style.display).toBe('flex');
    expect(close.style.display).toBe('none');
  });

  it('Escape closes an open panel and does nothing when it is closed', () => {
    const r = run();
    const panel = r.byId(`wgt-panel-${SHORT}`);
    r.docListeners.keydown![0]!({ key: 'Escape' });
    expect(panel.style.display).toBeUndefined();
    r.click(r.byId(`wgt-launch-${SHORT}`));
    r.docListeners.keydown![0]!({ key: 'Escape' });
    expect(panel.style.display).toBe('none');
  });

  it('the panel shows the business name, the reply time, the greeting, the intro message with a time, and Start Conversation', () => {
    const r = run({
      launcher: { ...DEFAULT_LAUNCHER, greeting: 'Namaste!', introMessage: 'We reply fast.' },
    });
    const texts = r.created.map((e) => e.textContent).filter(Boolean);
    expect(texts).toContain('Acme Shop');
    expect(texts).toContain('Typically replies within 5 mins');
    expect(texts).toContain('Namaste!');
    expect(texts).toContain('We reply fast.');
    expect(texts).toContain('Start Conversation');
    const time = r.created.find((e) => e.style.cssText.includes('bottom:5px'))!;
    expect(time.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('Start Conversation opens the WhatsApp link in a new tab without an opener', () => {
    const r = run({ whatsappUrl: 'https://wa.me/919876543210?text=Hello+there' });
    r.click(r.byId(`wgt-start-${SHORT}`));
    expect(r.opened).toEqual([
      {
        url: 'https://wa.me/919876543210?text=Hello+there',
        target: '_blank',
        features: 'noopener',
      },
    ]);
  });

  it('with no number Start Conversation is disabled and opens nothing', () => {
    const r = run({ whatsappUrl: null });
    const start = r.byId(`wgt-start-${SHORT}`);
    expect(start.disabled).toBe(true);
    expect(start.title).toBe('Add a WhatsApp number to start conversations');
    r.click(start);
    expect(r.opened).toEqual([]);
  });

  it('auto-open opens the panel once after 1.2 seconds; without it there is no timer', () => {
    expect(run().timers).toEqual([]);
    const r = run({ autoOpen: true });
    expect(r.timers.map((t) => t.ms)).toEqual([1200]);
    r.timers[0]!.fn();
    expect(r.byId(`wgt-panel-${SHORT}`).style.display).toBe('flex');
  });

  it('loading it twice mounts one launcher, except in the preview', () => {
    const doc = run();
    const win = doc.win;
    expect(win[`__wgtWidget_e174adbe-698d-4afd-b89c-2d5cba3a3820`]).toBe(true);
    // a second run on the same window does nothing
    const again = new Function('window', 'document', 'setTimeout', doc.script);
    let mounted = 0;
    again(
      win,
      {
        head: { appendChild: () => undefined },
        body: { appendChild: () => mounted++ },
        createElement: () => ({}),
      },
      () => 0,
    );
    expect(mounted).toBe(0);
  });

  it('the preview tells the page when the panel opens or closes, and can start open', () => {
    const r = run({ preview: true });
    r.click(r.byId(`wgt-launch-${SHORT}`));
    r.click(r.byId(`wgt-close-${SHORT}`));
    expect(r.messages).toEqual([
      { wgt: 'toggle', open: true },
      { wgt: 'toggle', open: false },
    ]);
    const open = run({ preview: true, startOpen: true });
    expect(open.byId(`wgt-panel-${SHORT}`).style.display).toBe('flex');
  });

  it('text that is markup or script stays text: it is only ever assigned as textContent and the program has no raw tag', () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const r = run({
      name: evil,
      launcher: { ...DEFAULT_LAUNCHER, greeting: evil, introMessage: evil },
    });
    expect(r.script).not.toContain('</script>');
    expect(r.script).not.toContain('<img');
    expect(r.created.filter((e) => e.textContent === evil).length).toBeGreaterThanOrEqual(3);
    expect(r.created.every((e) => !e.innerHTML.includes('onerror'))).toBe(true);
  });

  it('a line separator in the text cannot end the script literal', () => {
    const r = run({
      launcher: { ...DEFAULT_LAUNCHER, greeting: `a${String.fromCharCode(0x2028)}b` },
    });
    expect(r.script).toContain('\\u2028');
  });
});

describe('the embed route picks the program by mode', () => {
  const widget = {
    uuid: 'e174adbe-698d-4afd-b89c-2d5cba3a3820',
    name: 'Acme',
    launcher: DEFAULT_LAUNCHER,
    whatsappUrl: 'https://wa.me/1',
    position: 'bottom_right',
    buttonColor: '#075E54',
    buttonImageUrl: null,
    autoOpen: false,
  };
  const chat = 'https://crm.example/widget/TOKEN/chat';

  it('whatsapp draws the panel itself; ai and both load the chat page in a frame', () => {
    expect(buildEmbedScript({ ...widget, mode: 'whatsapp' }, chat)).toContain('Start Conversation');
    expect(buildEmbedScript({ ...widget, mode: 'whatsapp' }, chat)).not.toContain('iframe');
    for (const mode of ['ai', 'both']) {
      const js = buildEmbedScript({ ...widget, mode }, chat);
      expect(js).toContain("createElement('iframe')");
      expect(js).not.toContain('Start Conversation');
    }
  });
});

describe('the panel looks like the real messenger', () => {
  it('is 500px tall, shrinking only for a short page and the bottom spacing, on a warm chat area', () => {
    const r = run();
    const panel = r.byId(`wgt-panel-${SHORT}`);
    expect(panel.style.cssText).toContain('height:min(500px,calc(100vh - 100px - var(--wb,10px)))');
    expect(panel.style.cssText).toContain('width:360px');
    expect(panel.style.cssText).toContain('background:#EDE8E0');
  });

  it('puts the greeting and the intro in ONE white bubble with a tail and a 24-hour time at its bottom right', () => {
    const r = run({
      launcher: { ...DEFAULT_LAUNCHER, greeting: 'Namaste!', introMessage: 'We reply fast.' },
    });
    const bubble = r.created.find((e) => e.attrs['data-testid'] === 'wgt-intro')!;
    expect(bubble.style.cssText).toContain('background:#fff');
    expect(bubble.style.cssText).toContain('border-radius:0 12px 12px 12px');
    const inside = bubble.children.map((c) => c.textContent).filter(Boolean);
    expect(inside.slice(0, 2)).toEqual(['Namaste!', 'We reply fast.']);
    expect(bubble.children[0]!.style.cssText).toContain('border-top:9px solid #fff');
    const time = bubble.children.find((c) => c.style.cssText.includes('bottom:5px'))!;
    expect(time.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('has a divider above a full-width pill Start Conversation with the send icon before the bold text', () => {
    const r = run();
    const start = r.byId(`wgt-start-${SHORT}`);
    expect(start.style.cssText).toContain('width:100%');
    expect(start.style.cssText).toContain('border-radius:26px');
    expect(start.style.cssText).toContain('font-weight:700');
    expect(start.children[0]!.innerHTML).toContain('<svg');
    expect(start.children[1]!.textContent).toBe('Start Conversation');
    const foot = r.created.find((e) => e.children.includes(start))!;
    expect(foot.style.cssText).toContain('border-top:1px solid');
  });

  it('shows the business name in bold above the bold reply-time line, next to the round image', () => {
    const r = run();
    const head = r.created.find((e) => e.style.cssText.includes('gap:14px'))!;
    expect(head.children[0]!.tag).toBe('img');
    expect(head.children[0]!.style.cssText).toContain('border-radius:50%');
    const who = head.children[1]!;
    expect(who.children[0]!.textContent).toBe('Acme Shop');
    expect(who.children[0]!.style.cssText).toContain('font-weight:700');
    expect(who.children[1]!.style.cssText).toContain('font-weight:700');
  });
});

describe('the builder preview flags', () => {
  it('an empty greeting leaves only the intro in the bubble', () => {
    const r = run({ launcher: { ...DEFAULT_LAUNCHER, greeting: '', introMessage: 'Only this' } });
    const bubble = r.created.find((e) => e.attrs['data-testid'] === 'wgt-intro')!;
    expect(bubble.children.map((c) => c.textContent).filter(Boolean)[0]).toBe('Only this');
    expect(
      r.created.some(
        (e) => e.attrs['data-testid'] === 'wgt-greeting' && bubble.children.includes(e),
      ),
    ).toBe(false);
  });

  it('an inert Start Conversation keeps its look and opens nothing; without the flag a missing link disables it', () => {
    const inert = run({ whatsappUrl: null, inertStart: true });
    const start = inert.byId(`wgt-start-${SHORT}`);
    expect(start.disabled).toBe(false);
    expect(start.style.opacity).toBeUndefined();
    inert.click(start);
    expect(inert.opened).toEqual([]);
    expect(run({ whatsappUrl: null }).byId(`wgt-start-${SHORT}`).disabled).toBe(true);
  });
});
