// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showTransitionLoader } from './transition-loader';
import { signOut } from './sign-out';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('transition loader', () => {
  it('covers the page with the arcs and the logo, once however often it is asked', () => {
    showTransitionLoader();
    showTransitionLoader();
    const all = document.querySelectorAll('#geta-transition-loader');
    expect(all).toHaveLength(1);
    expect(all[0]!.querySelector('canvas')).not.toBeNull();
    expect(all[0]!.querySelector('img')?.getAttribute('src')).toBe('/images/geta-logo.png');
    expect(all[0]!.getAttribute('role')).toBe('status');
  });

  it('shows at once on sign-out, before the request has answered', async () => {
    let finish: () => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (finish = () => resolve(new Response())))),
    );
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const done = signOut('/login');
    expect(document.getElementById('geta-transition-loader')).not.toBeNull();
    expect(assign).not.toHaveBeenCalled();
    finish();
    await done;
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
