// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ShellHidden } from './shell-hidden';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let page: HTMLElement;

afterEach(() => {
  act(() => root?.unmount());
  page?.remove();
  root = null;
});

describe('ShellHidden', () => {
  it('takes the app sidebar and header out of the page while a builder is open, and puts them back', () => {
    page = document.createElement('div');
    page.innerHTML =
      '<aside id="sidebar"></aside><header id="top"></header><main><div id="slot"></div></main>';
    document.body.appendChild(page);
    const slot = page.querySelector<HTMLElement>('#slot')!;
    const layer = document.createElement('div');
    layer.dataset.testid = 'flow-builder';
    slot.appendChild(layer);
    root = createRoot(layer);
    act(() => root!.render(<ShellHidden />));

    expect(page.querySelector<HTMLElement>('#sidebar')!.style.display).toBe('none');
    expect(page.querySelector<HTMLElement>('#top')!.style.display).toBe('none');

    act(() => root!.unmount());
    root = null;
    expect(page.querySelector<HTMLElement>('#sidebar')!.style.display).toBe('');
    expect(page.querySelector<HTMLElement>('#top')!.style.display).toBe('');
  });
});
