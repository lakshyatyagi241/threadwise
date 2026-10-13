// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The address bar stands in for Next's router: `useSearchParams` reads it, and a "navigation" re-renders.
const nav = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const react = await import('react');
  return {
    useSearchParams: () => {
      const [, tick] = react.useState(0);
      react.useEffect(() => {
        const f = () => tick((n) => n + 1);
        nav.listeners.add(f);
        return () => void nav.listeners.delete(f);
      }, []);
      return new URLSearchParams(window.location.search);
    },
  };
});

import { useBuilderTab, type BuilderTab, type TabSet } from './web-bot-tabs';

const navigate = (url: string) =>
  act(async () => {
    window.history.pushState(null, '', url);
    nav.listeners.forEach((f) => f());
  });

let host: HTMLElement;
let root: Root;
function Probe({ exists, set }: { exists: boolean; set: TabSet }) {
  const [tab, setTab] = useBuilderTab(exists, set);
  return (
    <>
      <p data-testid="tab">{tab}</p>
      {(['build', 'faqs', 'customize'] as const).map((k) => (
        <button key={k} type="button" data-go={k} onClick={() => setTab(k)} />
      ))}
    </>
  );
}
const go = (k: BuilderTab) =>
  act(async () => host.querySelector<HTMLButtonElement>(`[data-go="${k}"]`)!.click());
const shown = () => host.querySelector('[data-testid="tab"]')!.textContent;
const mount = (exists: boolean, set: TabSet = { faqs: true, web: false }) =>
  act(async () => root.render(<Probe exists={exists} set={set} />));

beforeEach(() => {
  window.history.replaceState(null, '', '/flows/simple/f1');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('the builder tab and the address', () => {
  it('opens on FAQs for ?tab=faqs on a saved flow', async () => {
    window.history.replaceState(null, '', '/flows/simple/f1?tab=faqs&view=settings');
    await mount(true);
    expect(shown()).toBe('faqs');
  });

  it('a flow that has not been saved always opens on Build', async () => {
    window.history.replaceState(null, '', '/flows/simple/?tab=faqs');
    await mount(false);
    expect(shown()).toBe('build');
  });

  it('ignores FAQs when the person cannot read them, and Customize on a chat flow', async () => {
    window.history.replaceState(null, '', '/flows/simple/f1?tab=faqs');
    await mount(true, { faqs: false, web: false });
    expect(shown()).toBe('build');
  });

  it('choosing a tab writes it to the address without leaving the page, and Build clears it', async () => {
    await mount(true);
    await go('faqs');
    expect(shown()).toBe('faqs');
    expect(window.location.pathname + window.location.search).toBe('/flows/simple/f1?tab=faqs');
    await go('build');
    expect(shown()).toBe('build');
    expect(window.location.search).toBe('');
  });

  it('leaving FAQs drops the panel screen from the address', async () => {
    window.history.replaceState(null, '', '/flows/simple/f1?tab=faqs&view=new');
    await mount(true, { faqs: true, web: true });
    await go('customize');
    expect(window.location.search).toBe('?tab=customize');
  });

  it('follows the back button between tabs', async () => {
    await mount(true);
    await navigate('/flows/simple/f1?tab=faqs&view=test');
    expect(shown()).toBe('faqs');
    await navigate('/flows/simple/f1');
    expect(shown()).toBe('build');
  });

  it('a tab change before the first save does not touch the address', async () => {
    await mount(false);
    await go('faqs');
    expect(window.location.search).toBe('');
  });
});
