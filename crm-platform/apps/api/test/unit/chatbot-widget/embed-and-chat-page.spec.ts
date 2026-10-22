import { describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCHER } from '@crm/contracts';
import { renderChatPage } from '../../../src/modules/chatbot-widget/chat-page';
import {
  CHAT_TEXT,
  CHAT_TEXT_KEYS,
  pickChatLocale,
} from '../../../src/modules/chatbot-widget/chat-page-text';
import {
  buildEmbedScript,
  jsString,
  safeColour,
  safeHttpUrl,
} from '../../../src/modules/chatbot-widget/embed-script';

const widget = {
  uuid: 'e174adbe-698d-4afd-b89c-2d5cba3a3820',
  // The frame loader serves the AI and Both widgets; a WhatsApp widget draws its own panel (see launcher.spec.ts).
  mode: 'both',
  name: 'Acme',
  launcher: DEFAULT_LAUNCHER,
  whatsappUrl: null as string | null,
  position: 'bottom_right',
  buttonColor: '#075E54',
  buttonImageUrl: null as string | null,
  autoOpen: false,
};
const chat = 'https://crm.example/widget/TOKEN/chat';

/** Runs the generated loader against a tiny fake DOM and reports what it built. */
function run(script: string) {
  const created: Array<Record<string, unknown>> = [];
  const doc = {
    head: { appendChild: () => undefined },
    body: {
      appendChild(el: unknown) {
        (doc as { appended?: unknown }).appended = el;
      },
    },
    createElement(tag: string) {
      const el: Record<string, unknown> = {
        tag,
        style: { cssText: '', setProperty: () => undefined },
        children: [] as unknown[],
        attrs: {} as Record<string, string>,
        listeners: {} as Record<string, () => void>,
        appendChild(c: unknown) {
          (el.children as unknown[]).push(c);
        },
        setAttribute(k: string, v: string) {
          (el.attrs as Record<string, string>)[k] = v;
        },
        addEventListener(e: string, f: () => void) {
          (el.listeners as Record<string, () => void>)[e] = f;
        },
      };
      created.push(el);
      return el;
    },
  };
  const win: Record<string, unknown> = { addEventListener: () => undefined };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  new Function('window', 'document', 'setTimeout', script)(win, doc, (fn: () => void, ms: number) =>
    timers.push({ fn, ms }),
  );
  return { created, win, timers, doc };
}

describe('loader script (TW-WGT-008)', () => {
  it('TW-WGT-008: it builds a 56px launcher and a 380x560 hidden panel with the chat page in an iframe', () => {
    const { created } = run(buildEmbedScript(widget, chat));
    const btn = created.find((e) => e.tag === 'button')!;
    const panel = created.find(
      (e) => e.tag === 'div' && String((e.style as { cssText: string }).cssText).includes('380px'),
    )!;
    const frame = created.find((e) => e.tag === 'iframe')!;
    expect((btn.style as { cssText: string }).cssText).toContain('width:56px;height:56px');
    expect((btn.attrs as Record<string, string>)['aria-label']).toBe('Open chat');
    expect((btn.style as { background: string }).background).toBe('#075E54');
    expect((panel.style as { cssText: string }).cssText).toContain('display:none');
    expect((panel.style as { cssText: string }).cssText).toContain('width:380px;height:560px');
    expect(frame.src).toBe(chat);
  });

  it('TW-WGT-008: the panel sits on the right, or on the left for bottom_left; any other value renders right', () => {
    const right = run(buildEmbedScript(widget, chat)).created[0]!;
    expect(String((right.style as { cssText: string }).cssText)).toContain('right:24px');
    const left = run(buildEmbedScript({ ...widget, position: 'bottom_left' }, chat)).created[0]!;
    expect(String((left.style as { cssText: string }).cssText)).toContain('left:24px');
    const odd = run(buildEmbedScript({ ...widget, position: 'right' }, chat)).created[0]!;
    expect(String((odd.style as { cssText: string }).cssText)).toContain('right:24px');
  });

  it('TW-WGT-008: clicking the launcher toggles the panel between hidden and shown', () => {
    const { created } = run(buildEmbedScript(widget, chat));
    const btn = created.find((e) => e.tag === 'button')!;
    const panel = created.find(
      (e) => e.tag === 'div' && String((e.style as { cssText: string }).cssText).includes('380px'),
    )!;
    const style = panel.style as { display?: string; cssText: string };
    style.display = 'none';
    (btn.listeners as Record<string, () => void>).click!();
    expect(style.display).toBe('block');
    (btn.listeners as Record<string, () => void>).click!();
    expect(style.display).toBe('none');
  });

  it('TW-WGT-008: auto-open toggles once after 1.2 seconds; without it there is no timer', () => {
    expect(run(buildEmbedScript(widget, chat)).timers).toEqual([]);
    const t = run(buildEmbedScript({ ...widget, autoOpen: true }, chat)).timers;
    expect(t).toHaveLength(1);
    expect(t[0]!.ms).toBe(1200);
  });

  it('TW-WGT-008 #3: running the same script twice builds one launcher', () => {
    const script = buildEmbedScript(widget, chat);
    const win: Record<string, unknown> = {};
    let appended = 0;
    const doc = {
      body: { appendChild: () => void appended++ },
      createElement: () => ({
        style: {},
        setAttribute: () => undefined,
        appendChild: () => undefined,
        addEventListener: () => undefined,
      }),
    };
    const exec = () => new Function('window', 'document', 'setTimeout', script)(win, doc, () => 0);
    exec();
    exec();
    expect(appended).toBe(1);
  });

  it('TW-WGT-004 #4: without a launcher image the built-in chat glyph is used; with one the picture fills the button, round and with no ring', () => {
    expect(buildEmbedScript(widget, chat)).toContain('svg viewBox');
    const withImg = buildEmbedScript(
      { ...widget, buttonImageUrl: 'https://cdn.example/logo.png' },
      chat,
    );
    expect(withImg).toContain('https://cdn.example/logo.png');
    expect(withImg).toContain('width:100%;height:100%;border-radius:50%;object-fit:cover');
    expect(withImg).toContain("btn.style.background = 'transparent'");
    expect(withImg).not.toContain('svg viewBox');
  });

  it('TW-WGT-022 #5: hostile values cannot break out of the script or the style', () => {
    expect(safeColour('red;}</script>', '#075E54')).toBe('#075E54');
    expect(safeColour('#ABC', '#075E54')).toBe('#ABC');
    expect(safeColour('rgb(0, 0, 0)', '#075E54')).toBe('rgb(0, 0, 0)');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl("https://x.example/a'b")).toBe("https://x.example/a'b");
    expect(jsString('</script><script>alert(1)')).not.toContain('</script>');
    const evil = buildEmbedScript(
      { ...widget, buttonColor: "red'};alert(1);//", buttonImageUrl: "javascript:alert('x')" },
      chat,
    );
    expect(evil).not.toContain('alert(1)');
    expect(evil).not.toContain('javascript:');
    expect(evil).toContain('svg viewBox');
    expect(() => new Function('window', 'document', 'setTimeout', evil)).not.toThrow();
  });
});

describe('chat page (TW-WGT-009)', () => {
  const page = renderChatPage({
    uuid: widget.uuid,
    token: 'T'.repeat(48),
    name: 'Pricing <b>page</b>',
  });

  it('TW-WGT-009: the document title is the internal name, escaped', () => {
    expect(page).toContain('<title>Pricing &lt;b&gt;page&lt;/b&gt;</title>');
  });

  it('TW-WGT-009: the script is syntactically valid JavaScript', () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(page)![1]!;
    expect(() => new Function(script)).not.toThrow();
  });

  it('TW-WGT-009 #5: visitor text goes in with textContent, never as markup', () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(page)![1]!;
    expect(script).toContain('b.textContent = text');
    expect(script).not.toMatch(/innerHTML\s*=/);
  });

  it('TW-WGT-009: it asks for config, posts messages and polls history every 4 seconds', () => {
    expect(page).toContain("'/widget/' + TOKEN + '/api/'");
    expect(page).toContain('setInterval(poll, 4000)');
    expect(page).toContain("'Tell us a bit about you'");
    expect(page).toContain("'Open WhatsApp'");
    expect(page).toContain('placeholder="Type a message');
  });

  it('TW-WGT-023 rule 2 QUIRK: the remembered visitor key is built from the TOKEN, so rotating the token orphans a returning visitor (as Reference)', () => {
    expect(page).toContain("'wsnap_vid_' + TOKEN");
  });
});

describe('the chat page for a flow bot', () => {
  const page = renderChatPage({ uuid: widget.uuid, token: 'TOKEN', name: 'Acme' });

  it('draws reply buttons from the poll and sends a tap with its id', () => {
    expect(page).toContain('.chip');
    expect(page).toContain('payload.tap_id = tapId');
    expect(page).toContain('send(btn.title, btn.id)');
  });

  it('retires old buttons when any new line appears, and looks often for a while after the visitor writes', () => {
    expect(page).toContain('clearChips();');
    expect(page).toContain('function burstPoll()');
  });
});

describe('the panel of a flow bot (a website chat bot)', () => {
  it('is larger and softer than the AI widget panel, which keeps its original size', () => {
    const rich = run(buildEmbedScript({ ...widget, mode: 'ai', flow: true }, chat));
    const panel = rich.created.find(
      (e) =>
        e.tag === 'div' &&
        String((e.style as { cssText: string }).cssText).includes('display:none'),
    )!;
    const css = String((panel.style as { cssText: string }).cssText);
    expect(css).toContain('width:404px;height:672px');
    expect(css).toContain('border-radius:20px');
    const plain = run(buildEmbedScript({ ...widget, mode: 'ai' }, chat));
    const old = plain.created.find(
      (e) =>
        e.tag === 'div' &&
        String((e.style as { cssText: string }).cssText).includes('display:none'),
    )!;
    expect(String((old.style as { cssText: string }).cssText)).toContain(
      'width:380px;height:560px',
    );
  });

  it("listens for the chat window's close request, and only for its own frame", () => {
    const script = buildEmbedScript({ ...widget, mode: 'ai', flow: true }, chat);
    expect(script).toContain('e.source !== frame.contentWindow || !e.data');
    expect(script).toContain("e.data.wgt === 'close'");
    expect(script).toContain("e.data.wgt === 'expand'");
    expect(buildEmbedScript({ ...widget, mode: 'ai' }, chat)).not.toContain("wgt === 'close'");
  });

  it('its chat page draws a close button only when it is a flow bot, and starts violet', () => {
    const page = renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme', flow: true });
    expect(page).toContain('var FLOW = true;');
    expect(renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme' })).toContain(
      'var FLOW = false;',
    );
    expect(page).toContain('--accent: #5B4DDB');
  });
});

describe('the cross: Close this chat and Restart this chat', () => {
  it('is drawn for every website bot inside the site panel, not only a flow bot', () => {
    for (const flow of [true, false]) {
      const page = renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme', flow });
      expect(page).toContain('id="endpop"');
      expect(page).toContain('tx(o[0], o[1])');
      expect(page).toContain("'closeThis', 'Close this chat'");
      expect(page).toContain("'restartThis', 'Restart this chat'");
      expect(page).toContain("BASE + 'restart'");
    }
  });
});

describe("the chat window speaks the visitor's language", () => {
  it('has every word in all 21 languages, none empty', () => {
    expect(Object.keys(CHAT_TEXT)).toHaveLength(21);
    for (const [locale, words] of Object.entries(CHAT_TEXT))
      for (const k of CHAT_TEXT_KEYS) expect(words[k], `${locale}.${k}`).toBeTruthy();
  });

  it('picks a language from the browser header, with regional and Chinese variants, and falls back to English', () => {
    expect(pickChatLocale('hi-IN,hi;q=0.9,en;q=0.8')).toBe('hi');
    expect(pickChatLocale('pt-BR')).toBe('pt');
    expect(pickChatLocale('zh-TW,zh;q=0.9')).toBe('zh-CN');
    expect(pickChatLocale('xx-YY', undefined)).toBe('en');
    expect(pickChatLocale(undefined)).toBe('en');
    expect(pickChatLocale('fr-FR', 'de')).toBe('de');
  });

  it('draws the page in that language, flips a right-to-left one, and the script still parses', () => {
    const ar = renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme', locale: 'ar' });
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain(CHAT_TEXT.ar!.online);
    const script = /<script>([\s\S]*)<\/script>/.exec(ar)![1]!;
    expect(() => new Function('window', 'document', script)).not.toThrow();
    const en = renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme' });
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(renderChatPage({ uuid: widget.uuid, token: 'T', name: 'Acme', locale: 'zz' })).toContain(
      'lang="en"',
    );
  });
});

describe('the closed launcher of a flow bot: callout, animation and unread dot', () => {
  const flow = (launcher: Record<string, unknown>) =>
    buildEmbedScript(
      {
        ...widget,
        mode: 'ai',
        flow: true,
        launcher: { ...widget.launcher, ...launcher } as typeof widget.launcher,
      },
      chat,
    );
  const popup = (style: string, over: Record<string, unknown> = {}) => ({
    popup: { enabled: true, position: 'top', style, text: 'Need <b>help</b>?', image: '', ...over },
  });

  it.each(['bubble', 'pill', 'avatar', 'media', 'bar'])(
    "draws the %s callout with the author's text as text, never as markup",
    (style) => {
      const { created } = run(flow(popup(style)));
      const texts = created.map((e) => e.textContent).filter(Boolean);
      expect(texts).toContain('Need <b>help</b>?');
      expect(created.some((e) => String(e.innerHTML ?? '').includes('help'))).toBe(false);
    },
  );

  it('draws no callout while it is off, and the unread dot only while it is on', () => {
    const off = run(
      flow({
        popup: { enabled: false, position: 'top', style: 'bubble', text: 'Hi', image: '' },
        badge: true,
      }),
    );
    expect(off.created.map((e) => e.textContent)).not.toContain('Hi');
    // The unread dot is a red dot with no number in it.
    const dot = (created: Array<{ style: unknown }>) =>
      created.some((e) => String((e.style as { cssText: string }).cssText).includes('#ff4d5e'));
    expect(dot(off.created)).toBe(true);
    expect(off.created.map((e) => e.textContent)).not.toContain('1');
    expect(dot(run(flow({ badge: false })).created)).toBe(false);
  });

  it('adds the bounce or the ripple to the launcher button, and nothing for none', () => {
    const animationOf = (animation: string) => {
      const { created } = run(flow({ animation }));
      const btn = created.find(
        (e) =>
          e.tag === 'button' && (e.attrs as Record<string, string>)['aria-label'] === 'Open chat',
      )!;
      return (btn.style as { animation?: string }).animation;
    };
    expect(animationOf('bounce')).toContain('wgtBounce');
    expect(animationOf('ripple')).toContain('wgtRipple');
    expect(animationOf('none')).toBeUndefined();
  });

  it("keeps the AI widget's launcher exactly as it was (no callout code at all)", () => {
    const plain = buildEmbedScript({ ...widget, mode: 'ai' }, chat);
    expect(plain).not.toContain('wgtBounce');
    expect(plain).not.toContain('hideExtras');
  });
});

describe('the panel size and the frame permissions of a flow bot', () => {
  const panelCss = (size: string) => {
    const { created } = run(
      buildEmbedScript(
        {
          ...widget,
          mode: 'ai',
          flow: true,
          launcher: {
            ...widget.launcher,
            chat: { ...widget.launcher.chat, size },
          } as typeof widget.launcher,
        },
        chat,
      ),
    );
    const panel = created.find(
      (e) =>
        e.tag === 'div' &&
        String((e.style as { cssText: string }).cssText).includes('display:none'),
    )!;
    return String((panel.style as { cssText: string }).cssText);
  };

  it('follows the size the author chose', () => {
    expect(panelCss('compact')).toContain('width:372px;height:560px');
    expect(panelCss('tall')).toContain('width:404px;height:780px');
    expect(panelCss('wide')).toContain('width:468px;height:700px');
  });

  it('lets only the flow bot window copy and listen', () => {
    expect(buildEmbedScript({ ...widget, mode: 'ai', flow: true }, chat)).toContain(
      "'clipboard-write; microphone'",
    );
    expect(buildEmbedScript({ ...widget, mode: 'ai' }, chat)).not.toContain('microphone');
  });
});

describe('the chat window draws a bot line the way WhatsApp does', () => {
  const page = renderChatPage({
    uuid: widget.uuid,
    token: 'T'.repeat(48),
    name: 'Acme',
    flow: true,
  });
  const script = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(page)?.[1] ?? '';

  // A node with just what the formatter uses, so the real functions run as they are in the page.
  type Fake = { tag: string; text?: string; kids: Fake[] };
  const fakeDocument = {
    createElement: (tag: string): Fake & { appendChild(k: Fake): void } => {
      const n: Fake & { appendChild(k: Fake): void } = {
        tag,
        kids: [],
        appendChild(k) {
          n.kids.push(k);
        },
      };
      Object.defineProperty(n, 'textContent', {
        get: () =>
          n.kids
            .map((k) =>
              k.tag === '#text' ? k.text : (k as unknown as { textContent: string }).textContent,
            )
            .join(''),
        set: (v: string) => {
          n.kids = [{ tag: '#text', text: v, kids: [] }];
        },
      });
      return n;
    },
    createTextNode: (text: string): Fake => ({ tag: '#text', text, kids: [] }),
  };
  const draw = (text: string): string => {
    const from = script.indexOf('var MARKS');
    const to = script.indexOf('function plain');
    const body = script.slice(from, to) + '\nreturn { fmtInto: fmtInto };';
    const { fmtInto } = new Function('document', body)(fakeDocument) as {
      fmtInto: (el: unknown, t: string) => void;
    };
    const root = fakeDocument.createElement('div');
    fmtInto(root, text);
    const html = (n: Fake): string =>
      n.tag === '#text' ? (n.text ?? '') : `<${n.tag}>${n.kids.map(html).join('')}</${n.tag}>`;
    return root.kids.map(html).join('');
  };

  it('the page script is valid JavaScript', () => {
    expect(script.length).toBeGreaterThan(1000);
    expect(() => new Function(script)).not.toThrow();
  });

  it('turns *bold*, _italic_, ~strike~ and monospace into elements, with no marks left', () => {
    expect(draw('*Welcome to Admissions*\n\n_Please browse_')).toBe(
      '<b>Welcome to Admissions</b>\n\n<i>Please browse</i>',
    );
    expect(draw('a ~old~ and ```code``` and *bold _both_*')).toBe(
      'a <s>old</s> and <code>code</code> and <b>bold <i>both</i></b>',
    );
  });

  it('leaves a mark inside a word, a lone mark and any markup as typed', () => {
    expect(draw('snake_case_name and 2*3*4 and a * b')).toBe('snake_case_name and 2*3*4 and a * b');
    expect(draw('<b>x</b> *y*')).toBe('<b>x</b> <b>y</b>');
  });

  it('keeps reply buttons on screen after one is tapped, marks the tapped one, and gives a button no icon of its own', () => {
    expect(script).not.toContain('clearChips();\n    m.appendChild(row);');
    expect(script).toContain("c.classList.add('picked')");
    expect(script).not.toContain('M5 12h14');
  });

  it('draws no picture for an empty icon address (it used to resolve to the page itself)', () => {
    expect(page).toContain("if (!String(v || '').trim()) return '';");
  });
});
