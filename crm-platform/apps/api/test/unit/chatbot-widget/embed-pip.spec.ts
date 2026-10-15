import { describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCHER, widgetLauncherSchema } from '@crm/contracts';
import { buildEmbedScript } from '../../../src/modules/chatbot-widget/embed-script';

const base = {
  uuid: 'e174adbe-698d-4afd-b89c-2d5cba3a3820',
  mode: 'ai',
  name: 'Acme',
  whatsappUrl: null as string | null,
  position: 'bottom_right',
  buttonColor: '#075E54',
  buttonImageUrl: null as string | null,
  autoOpen: false,
  flow: true,
};
const chat = 'https://crm.example/widget/TOKEN/chat';
const withChat = (over: Record<string, unknown>) =>
  widgetLauncherSchema.parse({ ...DEFAULT_LAUNCHER, chat: { ...DEFAULT_LAUNCHER.chat, ...over } });

describe('the floating chat window in the embed script', () => {
  it('is left out unless the author turned it on', () => {
    const script = buildEmbedScript({ ...base, launcher: DEFAULT_LAUNCHER }, chat);
    expect(script).not.toContain('documentPictureInPicture');
    expect(() => new Function(script)).not.toThrow();
  });

  it('is added when it is on, still parses, and only reaches for the browser API that exists', () => {
    const script = buildEmbedScript({ ...base, launcher: withChat({ pip: true }) }, chat);
    expect(script).toContain("'documentPictureInPicture' in window");
    expect(script).toContain('requestWindow');
    expect(script).toContain('visibilitychange');
    expect(() => new Function(script)).not.toThrow();
  });

  it('is never added for a plain AI widget (only a website chat bot has it)', () => {
    const script = buildEmbedScript(
      { ...base, flow: false, launcher: withChat({ pip: true }) },
      chat,
    );
    expect(script).not.toContain('documentPictureInPicture');
  });

  it('keeps the launcher off the devices the author switched off, and opens by itself after the delay', () => {
    const script = buildEmbedScript(
      {
        ...base,
        launcher: withChat({
          devices: { desktop: true, tablet: false, mobile: true },
          autoOpen: 7,
        }),
      },
      chat,
    );
    expect(script).toContain('"tablet":false');
    expect(script).toContain('7000');
  });
});
