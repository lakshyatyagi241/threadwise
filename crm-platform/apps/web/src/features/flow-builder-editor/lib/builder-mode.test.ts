import { describe, expect, it } from 'vitest';
import { isSimpleBot, newHref, openHref } from './builder-mode';

describe('the editor a saved flow opens in (which flow is a bot)', () => {
  it('a WhatsApp flow made in Simple is a bot; one saved on the canvas is an automation', () => {
    expect(isSimpleBot('chat', 'simple')).toBe(true);
    expect(isSimpleBot('chat', null)).toBe(true);
    expect(isSimpleBot('chat', 'advanced')).toBe(false);
  });

  it('a website chat bot is a bot whatever its builder, and a call or another channel never is', () => {
    expect(isSimpleBot('web', 'advanced')).toBe(true);
    expect(isSimpleBot('call', 'advanced')).toBe(false);
    expect(isSimpleBot('instagram', 'simple')).toBe(false);
  });
});

describe('builder mode links', () => {
  it('a messaging flow built on the canvas opens on the canvas, whatever the workspace setting', () => {
    expect(openHref('f1', 'chat', 'advanced')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'chat', 'simple')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'chat', undefined)).toBe('/flows/simple/f1');
  });

  it('a website chat bot opens in Simple even when its builder says advanced', () => {
    expect(openHref('f1', 'web', 'advanced')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'web')).toBe('/flows/simple/f1');
  });

  it('a WhatsApp bot made in Simple opens in the Simple builder during the migration', () => {
    expect(openHref('f1', 'chat', 'simple')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'chat')).toBe('/flows/simple/f1');
  });

  it('a call flow and an automation on another channel open on the canvas', () => {
    expect(openHref('f1', 'call')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'instagram')).toBe('/flows/builder/f1');
  });

  it('a new bot is made in the Simple builder, and a new website chat bot carries its channel', () => {
    expect(newHref()).toBe('/flows/simple');
    expect(newHref()).toBe('/flows/simple');
    expect(newHref('web')).toBe('/flows/simple?type=web');
  });
});
