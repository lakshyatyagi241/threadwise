// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { opensNodeOnDoubleClick, opensNodeOnEnter } from './node-open';

function card(inner: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<div data-node-id="n_1" class="node-card">${inner}</div>`;
  return el;
}

describe('opensNodeOnDoubleClick', () => {
  it('opens on the card body, the header and the preview', () => {
    const el = card(
      '<div class="head"><span class="title">Send message</span></div><div class="preview">Hi</div>',
    );
    expect(opensNodeOnDoubleClick(el.querySelector('.title'))).toBe(true);
    expect(opensNodeOnDoubleClick(el.querySelector('.preview'))).toBe(true);
    expect(opensNodeOnDoubleClick(el.querySelector('.node-card'))).toBe(true);
  });

  it('leaves a text box, a button, a link and a connection dot to their own double-click', () => {
    const el = card(
      '<textarea></textarea><input /><button><span class="in-btn">Share</span></button><a href="#">x</a><div data-port="out:n_1:p0"></div><div contenteditable="true"><b class="rich">t</b></div>',
    );
    expect(opensNodeOnDoubleClick(el.querySelector('textarea'))).toBe(false);
    expect(opensNodeOnDoubleClick(el.querySelector('input'))).toBe(false);
    expect(opensNodeOnDoubleClick(el.querySelector('.in-btn'))).toBe(false);
    expect(opensNodeOnDoubleClick(el.querySelector('a'))).toBe(false);
    expect(opensNodeOnDoubleClick(el.querySelector('[data-port]'))).toBe(false);
    expect(opensNodeOnDoubleClick(el.querySelector('.rich'))).toBe(false);
  });

  it('opens when the target is not an element', () => {
    expect(opensNodeOnDoubleClick(null)).toBe(true);
  });
});

describe('opensNodeOnEnter', () => {
  it('opens when the focus is on the canvas or the card itself', () => {
    const el = card('<div class="preview">Hi</div>');
    expect(opensNodeOnEnter(el.querySelector('.preview'))).toBe(true);
    expect(opensNodeOnEnter(document.body)).toBe(true);
  });

  it('leaves a focused button (the toolbar Delete), a link and a connection dot to their own Enter', () => {
    const el = card('<button><span class="ic">x</span></button><a href="#">x</a><div data-port="out:n_1"></div>');
    expect(opensNodeOnEnter(el.querySelector('.ic'))).toBe(false);
    expect(opensNodeOnEnter(el.querySelector('a'))).toBe(false);
    expect(opensNodeOnEnter(el.querySelector('[data-port]'))).toBe(false);
  });
});
