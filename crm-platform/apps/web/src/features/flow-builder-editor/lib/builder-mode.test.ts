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
  it('a messaging flow built on the canvas opens on the canvas even in a Simple workspace (the list card passes its builder)', () => {
    expect(openHref('f1', 'chat', 'simple', 'advanced')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'chat', 'simple', 'simple')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'chat', 'simple', undefined)).toBe('/flows/simple/f1');
  });

  it('a website chat bot opens in Simple even when its builder says advanced', () => {
    expect(openHref('f1', 'web', 'simple', 'advanced')).toBe('/flows/simple/f1');
  });

  it('a WhatsApp bot opens in the Simple builder whatever the workspace uses (during the migration)', () => {
    expect(openHref('f1', 'chat')).toBe('/flows/simple/f1');
    expect(openHref('f1', 'chat')).toBe('/flows/simple/f1');
  });

  it('in an Advanced workspace every flow opens on the canvas', () => {
    expect(openHref('f1', 'chat', 'advanced')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'web', 'advanced')).toBe('/flows/builder/f1');
    expect(openHref('f1', 'chat', 'simple')).toBe('/flows/simple/f1');
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
