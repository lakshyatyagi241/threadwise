// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rewrite = vi.fn(async (input: { text: string; action: string; language?: string }) => ({
  text: `[${input.action}${input.language ? ':' + input.language : ''}] ${input.text}`,
  model: 'm',
}));
vi.mock('../api/service', () => ({ inboxApi: { rewrite: (i: never) => rewrite(i) } }));

import { ComposerToolbar, type AiModelChoice } from './composer-toolbar';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  rewrite.mockClear();
});

function Harness({ model, initial }: { model: AiModelChoice | null; initial: string }) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea
        ref={area}
        data-testid="box"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ComposerToolbar
        model={model}
        area={area}
        text={text}
        max={1000}
        disabled={false}
        onText={setText}
      />
    </>
  );
}
async function show(model: AiModelChoice | null, initial: string) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness model={model} initial={initial} />
      </NextIntlClientProvider>,
    );
  });
  return host.querySelector<HTMLTextAreaElement>('[data-testid="box"]')!;
}
const click = (sel: string) =>
  act(async () => {
    document.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const MODEL: AiModelChoice = { provider: 'openai', value: 'gpt-x' };

describe('the composer formatting row', () => {
  it('bold, italic and strike wrap the selection; the lists prefix the lines', async () => {
    const box = await show(MODEL, 'hello world');
    box.setSelectionRange(0, 5);
    await click('[data-testid="composer-bold"]');
    expect(box.value).toBe('*hello* world');
    await click('[data-testid="composer-bullets"]');
    expect(box.value).toBe('- *hello* world');
    box.setSelectionRange(3, 8);
    await click('[data-testid="composer-underline"]');
    expect(box.value).toContain('h\u0332e\u0332l\u0332l\u0332o\u0332');
  });

  it('keeps the AI button off, with the reason, when no model is enabled', async () => {
    await show(null, 'hi');
    const ai = document.querySelector<HTMLButtonElement>('[data-testid="composer-ai"]')!;
    expect(ai.disabled).toBe(true);
    expect(ai.title).toBe('No AI model is enabled for this workspace');
  });

  it('Condense rewrites the whole message with the chosen model', async () => {
    const box = await show(MODEL, 'a long message');
    await click('[data-testid="composer-ai"]');
    await click('[data-testid="composer-ai-condense"]');
    expect(rewrite).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-x',
        action: 'condense',
        text: 'a long message',
      }),
    );
    expect(box.value).toBe('[condense] a long message');
  });

  it('Translate opens a searchable language list and sends the English name', async () => {
    const box = await show(MODEL, 'good morning');
    await click('[data-testid="composer-ai"]');
    await click('[data-testid="composer-ai-translate"]');
    expect(document.querySelector('[data-testid="composer-ai-languages"]')).not.toBeNull();
    await click('[data-testid="composer-lang-ar"]');
    expect(rewrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'translate', language: 'Arabic', text: 'good morning' }),
    );
    expect(box.value).toBe('[translate:Arabic] good morning');
  });

  it('asks for a message first when the box is empty', async () => {
    await show(MODEL, '');
    await click('[data-testid="composer-ai"]');
    await click('[data-testid="composer-ai-fix"]');
    expect(rewrite).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Write a message first.');
  });
});
