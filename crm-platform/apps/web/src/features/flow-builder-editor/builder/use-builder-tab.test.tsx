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
      {(['build', 'customize', 'deploy'] as const).map((k) => (
        <button key={k} type="button" data-go={k} onClick={() => setTab(k)} />
      ))}
    </>
  );
}
const go = (k: BuilderTab) =>
  act(async () => host.querySelector<HTMLButtonElement>(`[data-go="${k}"]`)!.click());
const shown = () => host.querySelector('[data-testid="tab"]')!.textContent;
const mount = (exists: boolean, set: TabSet = { web: true }) =>
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
  it('opens on Customize for ?tab=customize on a saved flow', async () => {
    window.history.replaceState(null, '', '/flows/simple/f1?tab=customize');
    await mount(true);
    expect(shown()).toBe('customize');
  });

  it('a flow that has not been saved always opens on Build', async () => {
    window.history.replaceState(null, '', '/flows/simple/?tab=customize');
    await mount(false);
    expect(shown()).toBe('build');
  });

  it('opens on Build for an old ?tab=faqs link, and for Customize on a flow without it', async () => {
    window.history.replaceState(null, '', '/flows/simple/f1?tab=faqs');
    await mount(true);
    expect(shown()).toBe('build');
    window.history.replaceState(null, '', '/flows/simple/f1?tab=customize');
    await mount(true, { web: false });
    expect(shown()).toBe('build');
  });

  it('choosing a tab writes it to the address without leaving the page, and Build clears it', async () => {
    await mount(true);
    await go('customize');
    expect(shown()).toBe('customize');
    expect(window.location.pathname + window.location.search).toBe(
      '/flows/simple/f1?tab=customize',
    );
    await go('build');
    expect(shown()).toBe('build');
    expect(window.location.search).toBe('');
  });

  it('follows the back button between tabs', async () => {
    await mount(true);
    await navigate('/flows/simple/f1?tab=deploy');
    expect(shown()).toBe('deploy');
    await navigate('/flows/simple/f1');
    expect(shown()).toBe('build');
  });

  it('a tab change before the first save does not touch the address', async () => {
    await mount(false);
    await go('customize');
    expect(window.location.search).toBe('');
  });
});
