// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@crm/ui';
import { DeleteHistoryOption } from './delete-history-option';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

type Tree = { [k: string]: string | Tree };
const messages = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'contacts-attributes-tags.json'), 'utf8'),
  ) as Tree;
const erase = (locale: string) =>
  (messages(locale)['contacts-attributes-tags'] as Tree)['erase'] as Record<string, string>;

/** The delete confirmation as the contacts screen builds it: the message, what is erased, and the checkbox. */
function Harness({ onConfirm }: { onConfirm: (keep: boolean) => void }) {
  const [keep, setKeep] = useState(false);
  return (
    <ConfirmDialog
      open
      tone="danger"
      title="t"
      message={<DeleteHistoryOption keepHistory={keep} onChange={setKeep} />}
      confirmLabel="Delete"
      cancelLabel="Keep"
      onClose={() => undefined}
      onConfirm={() => onConfirm(keep)}
    />
  );
}

describe.each(['en', 'ar'])('contact delete dialog history option (%s)', (locale) => {
  it('says what is erased and offers an unchecked "keep history" box that is sent on confirm', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
          <Harness onConfirm={onConfirm} />
        </NextIntlClientProvider>,
      );
    });
    const words = erase(locale);
    expect(host.textContent).toContain(words.scope);
    const box = host.querySelector<HTMLInputElement>('#keep-history')!;
    expect(box.checked).toBe(false);
    expect(host.textContent).toContain(words.keepHistory);

    const del = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!;
    await act(async () => del.click());
    expect(onConfirm).toHaveBeenLastCalledWith(false);

    await act(async () => box.click());
    expect(box.checked).toBe(true);
    await act(async () => del.click());
    expect(onConfirm).toHaveBeenLastCalledWith(true);

    await act(async () => root.unmount());
    host.remove();
  });
});
