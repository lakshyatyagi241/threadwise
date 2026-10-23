// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, SearchClearLabelProvider } from '@crm/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const type = (el: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

function Controlled({ onQ }: { onQ: (q: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <SearchClearLabelProvider label="Clear search">
      <Input
        type="search"
        aria-label="Search tasks"
        value={q}
        className="h-9 ps-9 sm:w-72"
        onChange={(e) => {
          setQ(e.target.value);
          onQ(e.target.value);
        }}
      />
    </SearchClearLabelProvider>
  );
}

describe('search Input clear button', () => {
  it('shows only while there is text, clears through onChange and keeps focus in the field', () => {
    const onQ = vi.fn();
    act(() => root.render(<Controlled onQ={onQ} />));
    const input = host.querySelector('input')!;
    expect(host.querySelector('button')).toBeNull();

    type(input, 'kapoor');
    const clear = host.querySelector('button')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear search');
    expect(clear.className).toContain('end-1.5');

    act(() => clear.click());
    expect(onQ).toHaveBeenLastCalledWith('');
    expect(input.value).toBe('');
    expect(host.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('puts the width classes on the wrapper so the field keeps its place', () => {
    act(() => root.render(<Controlled onQ={vi.fn()} />));
    const wrapper = host.querySelector('input')!.parentElement!;
    expect(wrapper.className).toContain('sm:w-72');
    expect(host.querySelector('input')!.className).not.toContain('sm:w-72');
  });

  it('works for an uncontrolled field and honours its own clearLabel', () => {
    act(() => root.render(<Input type="search" aria-label="Find" clearLabel="Empty it" />));
    const input = host.querySelector('input')!;
    type(input, 'a');
    const clear = host.querySelector('button')!;
    expect(clear.getAttribute('aria-label')).toBe('Empty it');
    act(() => clear.click());
    expect(input.value).toBe('');
  });

  it('leaves other input types without a clear button', () => {
    act(() => root.render(<Input type="text" defaultValue="abc" />));
    expect(host.querySelector('button')).toBeNull();
  });
});
