'use client';

import { useEffect } from 'react';

/**
 * The editor's side of the preview iframe (TW-CMS-018/019/020). It makes every `[data-fc]` element click-to-edit (Enter saves,
 * Escape cancels), reports selections to the editor shell and applies colour changes at once. It only talks to a parent on the
 * same origin and never reads or writes content itself: the shell saves drafts through the operator API.
 */
export function PreviewBridge() {
  useEffect(() => {
    const origin = window.location.origin;
    const post = (msg: Record<string, unknown>) => {
      if (window.parent !== window) window.parent.postMessage({ source: 'fc', ...msg }, origin);
    };
    let active: HTMLElement | null = null;
    let before = '';

    const finish = (commit: boolean) => {
      const el = active;
      if (!el) return;
      active = null;
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-fc-active');
      const type = el.dataset.fcType ?? 'text';
      const value = type === 'richtext' ? el.innerHTML : (el.textContent ?? '');
      if (!commit) {
        if (type === 'richtext') el.innerHTML = before;
        else el.textContent = before;
        return;
      }
      if (value !== before) post({ type: 'edit', key: el.dataset.fc, value });
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest<HTMLElement>('a[href], button[type="submit"]');
      const field = target.closest<HTMLElement>('[data-fc]');
      if (link) e.preventDefault();
      if (field && field === active) return;
      if (active) finish(true);
      const urlHost = target.closest<HTMLElement>('[data-fc-url]');
      if (!field) {
        if (urlHost) {
          post({
            type: 'select',
            key: urlHost.dataset.fcUrl,
            fieldType: 'link',
            value: urlHost.getAttribute('href') ?? '',
            urlKey: urlHost.dataset.fcUrl,
          });
        }
        return;
      }
      e.preventDefault();
      const type = field.dataset.fcType ?? 'text';
      before = type === 'richtext' ? field.innerHTML : (field.textContent ?? '');
      active = field;
      field.setAttribute('data-fc-active', 'true');
      field.setAttribute('contenteditable', 'plaintext-only');
      if (field.contentEditable !== 'plaintext-only') field.contentEditable = 'true';
      field.focus();
      post({
        type: 'select',
        key: field.dataset.fc,
        fieldType: type,
        value: before,
        urlKey: urlHost?.dataset.fcUrl,
        url: urlHost?.getAttribute('href') ?? undefined,
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (active && e.target === active) finish(true);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.source !== 'fc') return;
      if (e.data.type === 'theme' && e.data.vars) {
        const root = document.querySelector<HTMLElement>('.cms-site');
        for (const [k, v] of Object.entries(e.data.vars as Record<string, string>)) {
          if (/^--site-[a-z]+-[a-z0-9]+$/.test(k) && /^#[0-9a-f]{3,6}$/i.test(v)) {
            root?.style.setProperty(k, v);
          }
        }
      }
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('message', onMessage);
    };
  }, []);
  return null;
}
