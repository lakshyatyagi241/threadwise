import { describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCHER } from '@crm/contracts';
import { renderChatPage } from '../../../src/modules/chatbot-widget/chat-page';
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
    body: {
      appendChild(el: unknown) {
        (doc as { appended?: unknown }).appended = el;
      },
    },
    createElement(tag: string) {
      const el: Record<string, unknown> = {
        tag,
        style: { cssText: '' },
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
  const win: Record<string, unknown> = {};
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

  it('TW-WGT-004 #4: without a launcher image the built-in chat glyph is used; with one the image is 36px round', () => {
    expect(buildEmbedScript(widget, chat)).toContain('svg viewBox');
    const withImg = buildEmbedScript(
      { ...widget, buttonImageUrl: 'https://cdn.example/logo.png' },
      chat,
    );
    expect(withImg).toContain('https://cdn.example/logo.png');
    expect(withImg).toContain('width:36px;height:36px;border-radius:50%');
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
