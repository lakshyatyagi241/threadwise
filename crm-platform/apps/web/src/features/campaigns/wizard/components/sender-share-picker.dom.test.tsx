// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { initialState, wizardReducer, type WizardAction } from '../lib/state';
import { count, credit, draft, html, sender, session, templates, ready, uuid } from '../testing';
import { StepReview } from './step-review';
import { StepTemplate } from './step-template';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const A = sender({ key: `waba:${uuid(41)}`, label: 'Line A', phone: '+911111111111' });
const B = sender({
  key: `waba:${uuid(42)}`,
  label: 'Line B',
  phone: '+912222222222',
  isDefault: false,
});
const C = sender({
  key: `waba:${uuid(43)}`,
  label: 'Line C',
  phone: '+913333333333',
  isDefault: false,
});
const classic = sender({
  key: `baileys:${uuid(44)}`,
  label: 'Personal',
  engine: 'baileys',
  engineLabel: 'Personal',
  isDefault: false,
  guided: false,
});

let latest = initialState();

function Harness({ senders, start }: { senders: ReturnType<typeof sender>[]; start?: object }) {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initialState>, a: WizardAction) => {
      latest = wizardReducer(s, a);
      return latest;
    },
    initialState(draft({ senderKey: A.key, ...start })),
  );
  const d = state.draft;
  return (
    <StepTemplate
      name="x"
      templateId={null}
      senderKey={d.senderKey}
      senderKeys={d.senderKeys}
      senderShare={d.senderShare}
      senders={senders}
      templates={ready({ data: templates() })}
      issues={[]}
      onName={() => undefined}
      onTemplate={() => undefined}
      onSender={(key) => dispatch({ type: 'sender', senderKey: key })}
      onSenders={(keys, share) => dispatch({ type: 'senders', keys, share })}
    />
  );
}

let root: ReturnType<typeof createRoot> | null = null;
function mount(props: Parameters<typeof Harness>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider session={session()}>
            <ToastProvider>
              <Harness {...props} />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  root = null;
  latest = initialState();
});

const toggle = () =>
  [...document.querySelectorAll('label')]
    .find((l) => l.textContent?.includes('Share this send across several numbers'))
    ?.querySelector('input') as HTMLInputElement | undefined;
const box = (label: string) =>
  document.querySelector(`input[type="checkbox"][aria-label^="${label}"]`) as HTMLInputElement;
const weight = (name: string) =>
  document.querySelector(`input[aria-label="Share of ${name}"]`) as HTMLInputElement;
const percent = (key: string) =>
  document.querySelector(`[data-testid="share-percent-${key}"]`)?.textContent;
const click = (el: Element) => act(() => (el as HTMLElement).click());
function type(el: HTMLInputElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the share picker in step 1 (TW-BCAST-006)', () => {
  it('is not offered with one number', () => {
    mount({ senders: [A] });
    expect(toggle()).toBeUndefined();
  });

  it('with two or more numbers the single select stays; ticking the option shows a tick list, a personal number included', () => {
    mount({ senders: [A, B, classic] });
    expect(document.querySelector('#wizard-sender')).not.toBeNull();
    click(toggle()!);
    expect(document.querySelector('[data-testid="sender-share-picker"]')).not.toBeNull();
    expect(box('Line A').checked).toBe(true);
    expect(box('Line B').checked).toBe(false);
    // A personal (device) number can share a send too.
    click(box('Personal'));
    expect(latest.draft.senderKeys).toEqual([A.key, classic.key]);
  });

  it('weights 7 and 3 show 70% and 30% and are saved on the draft, the first number picked staying the primary', () => {
    mount({ senders: [A, B] });
    click(toggle()!);
    click(box('Line B'));
    expect(latest.draft.senderKeys).toEqual([A.key, B.key]);
    expect(percent(A.key)).toBe('50%');
    type(weight('Line A'), '7');
    type(weight('Line B'), '3');
    expect(percent(A.key)).toBe('70%');
    expect(percent(B.key)).toBe('30%');
    expect(latest.draft.senderShare).toEqual({ [A.key]: 7, [B.key]: 3 });
    expect(latest.draft.senderKey).toBe(A.key);
  });

  it('an empty or 0 weight counts as 1 and the percentage says so', () => {
    mount({ senders: [A, B] });
    click(toggle()!);
    click(box('Line B'));
    type(weight('Line A'), '0');
    type(weight('Line B'), '1');
    expect(percent(A.key)).toBe('50%');
    type(weight('Line B'), '');
    expect(latest.draft.senderShare).toEqual({ [A.key]: 0 });
    expect(percent(B.key)).toBe('50%');
  });

  it('the last ticked number cannot be unticked; unticking the first hands the primary to the next', () => {
    mount({ senders: [A, B, C] });
    click(toggle()!);
    expect(box('Line A').disabled).toBe(true);
    click(box('Line B'));
    click(box('Line C'));
    click(box('Line A'));
    expect(latest.draft.senderKeys).toEqual([B.key, C.key]);
    expect(latest.draft.senderKey).toBe(B.key);
  });

  it('back to one tick is the plain single number: senderKeys and the weights are cleared', () => {
    mount({ senders: [A, B] });
    click(toggle()!);
    click(box('Line B'));
    type(weight('Line B'), '5');
    click(box('Line A'));
    expect(latest.draft.senderKey).toBe(B.key);
    expect(latest.draft.senderKeys).toEqual([]);
    expect(latest.draft.senderShare).toEqual({});
  });

  it('a saved draft that already shares opens with the picker, and turning the option off keeps the first number', () => {
    mount({
      senders: [A, B],
      start: { senderKeys: [A.key, B.key], senderShare: { [A.key]: 2, [B.key]: 1 } },
    });
    expect(document.querySelector('[data-testid="sender-share-picker"]')).not.toBeNull();
    expect(percent(A.key)).toBe('67%');
    expect(toggle()!.checked).toBe(true);
    click(toggle()!);
    expect(latest.draft.senderKey).toBe(A.key);
    expect(latest.draft.senderKeys).toEqual([]);
    expect(document.querySelector('#wizard-sender')).not.toBeNull();
  });
});

describe('the Review step shows the split', () => {
  const summary = (d: ReturnType<typeof draft>) =>
    html(
      <StepReview
        draft={d}
        template={null}
        sender={A}
        senders={[A, B, C]}
        sources={undefined}
        count={count({ recipients: 8 })}
        credit={ready(credit({ recipients: 8 }))}
        properties={[]}
        issues={[]}
        showIssues={false}
        onVariable={() => undefined}
        onVariables={() => undefined}
        dispatch={() => undefined}
        onEdit={() => undefined}
      />,
    );

  it('3 numbers with shares 2/1/1 over 8 recipients read 4, 2 and 2 beside their names', () => {
    const out = summary(
      draft({
        senderKey: A.key,
        senderKeys: [A.key, B.key, C.key],
        senderShare: { [A.key]: 2, [B.key]: 1, [C.key]: 1 },
      }),
    );
    expect(out).toContain('Split across numbers');
    expect(out).toContain('Line A');
    expect(out).toContain('4 recipients (50%)');
    expect(out).toContain('2 recipients (25%)');
  });

  it('one number has no split row', () => {
    expect(summary(draft({ senderKey: A.key }))).not.toContain('Split across numbers');
  });
});
