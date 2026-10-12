import { describe, expect, it } from 'vitest';
import { newHref, openHref } from './builder-mode';

describe('builder mode links', () => {
  it('opens a messaging flow in the Simple builder only in Simple mode', () => {
    expect(openHref('simple', 'f1', 'chat')).toBe('/flows/simple/f1');
    expect(openHref('advanced', 'f1', 'chat')).toBe('/flows/builder/f1');
  });

  it('a call flow always opens on the canvas', () => {
    expect(openHref('simple', 'f1', 'call')).toBe('/flows/builder/f1');
  });

  it('a new flow goes to the Simple builder only in Simple mode', () => {
    expect(newHref('simple')).toBe('/flows/simple');
    expect(newHref('advanced')).toBe('/flows/builder');
  });

  it('a website chat bot opens in the Simple builder in Simple mode and on the canvas otherwise', () => {
    expect(openHref('simple', 'f1', 'web')).toBe('/flows/simple/f1');
    expect(openHref('advanced', 'f1', 'web')).toBe('/flows/builder/f1');
  });

  it('a new website chat bot carries its channel to either builder', () => {
    expect(newHref('simple', 'web')).toBe('/flows/simple?type=web');
    expect(newHref('advanced', 'web')).toBe('/flows/builder?type=web');
    expect(newHref('simple', 'chat')).toBe('/flows/simple');
  });
});
