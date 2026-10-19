import { describe, expect, it } from 'vitest';
import { newHref, openHref } from './builder-mode';

describe('builder mode links', () => {
  it('a WhatsApp bot opens in the Simple builder whatever the workspace uses (during the migration)', () => {
    expect(openHref('f1', 'chat')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'chat')).toBe('/flows/simple/f1');
  });

  it('a call flow always opens on the canvas', () => {
    expect(openHref('f1', 'call')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'call')).toBe('/flows/builder/f1');
  });

  it('an automation on another channel opens on the canvas', () => {
    expect(openHref('f1', 'instagram')).toBe('/flows/builder/f1');
  });

  it('a website chat bot always opens in the Simple builder', () => {
    expect(openHref('f1', 'web')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'web')).toBe('/flows/simple/f1');
  });

  it('a new bot is made in the Simple builder, and a new website chat bot carries its channel', () => {
    expect(newHref()).toBe('/flows/simple');
    expect(newHref()).toBe('/flows/simple');
    expect(newHref('web')).toBe('/flows/simple?type=web');
  });
});
