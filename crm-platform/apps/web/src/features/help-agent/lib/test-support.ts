/**
 * Test helpers: a jsdom page has no layout, and the page-agent library only lists elements that "have a size". These give every
 * element a box so the library's own DOM reader works in a unit test. Never imported by the app.
 */
export function giveEverythingALayout(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 120 });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 24 });
  // Every element gets its own row (30px apart) in document order, so `elementFromPoint` can find the element the library clicks.
  const all = () => Array.from(document.getElementsByTagName('*'));
  const rectOf = (el: Element) => {
    const top = Math.max(0, all().indexOf(el)) * 30;
    return { width: 120, height: 24, top, left: 0, right: 120, bottom: top + 24, x: 0, y: top };
  };
  const ep = Element.prototype as unknown as Record<string, unknown>;
  ep.getClientRects = function (this: Element) {
    return [rectOf(this)];
  };
  ep.getBoundingClientRect = function (this: Element) {
    return rectOf(this);
  };
  ep.scrollIntoView = () => undefined;
  (document as unknown as Record<string, unknown>).elementFromPoint = (_x: number, y: number) =>
    all()[Math.floor(y / 30)] ?? null;
  if (typeof CSS === 'undefined' || !CSS.escape) {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/[^\w-]/g, '\\$&'),
    };
  }
}

export interface ScriptedStep {
  /** The model's chosen action: `{ click_element_by_index: { index: 3 } }` or `{ done: { text: 'ok', success: true } }`. */
  action: Record<string, unknown>;
  goal?: string;
}

/**
 * A fake OpenAI-compatible endpoint: answers each `chat/completions` call with the next scripted tool call, exactly as a vendor does
 * (a `AgentOutput` function call), and keeps what it was sent so a test can look at it. No network.
 */
export function scriptedModel(steps: ScriptedStep[]) {
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  let call = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const step = steps[Math.min(call, steps.length - 1)]!;
    call += 1;
    return new Response(
      JSON.stringify({
        id: `fake-${call}`,
        object: 'chat.completion',
        model: 'fake',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call-${call}`,
                  type: 'function',
                  function: {
                    name: 'AgentOutput',
                    arguments: JSON.stringify({
                      evaluation_previous_goal: 'ok',
                      memory: 'm',
                      next_goal: step.goal ?? `step ${call}`,
                      action: step.action,
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { fetchImpl, requests };
}
