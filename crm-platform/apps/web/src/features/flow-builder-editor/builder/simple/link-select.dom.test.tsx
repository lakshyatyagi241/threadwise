// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { emptyDoc, insertStep, newStep } from '../../lib/simple-model';
import { LinkSelect } from './step-editors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  document.body.innerHTML = '';
});

function options(props: { noSelf?: boolean; value?: string | null }) {
  let doc = emptyDoc();
  const a = newStep('message', []);
  doc = insertStep(doc, 0, 0, a);
  const b = newStep('message', [a]);
  doc = insertStep(doc, 0, 1, b);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <LinkSelect
          doc={doc}
          stepId={b.id}
          value={props.value ?? null}
          onChange={() => {}}
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
  const ids = [...host.querySelectorAll('option')].map((o) => o.getAttribute('value'));
  act(() => root.unmount());
  return { ids, a: a.id, b: b.id };
}

describe('LinkSelect', () => {
  it('offers the step itself to a button, which may lead back to its own step', () => {
    const { ids, b } = options({});
    expect(ids).toContain(b);
  });

  it('leaves the step itself out of its own "Then go to", which would repeat forever', () => {
    const { ids, a, b } = options({ noSelf: true });
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });
});
