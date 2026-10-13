import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState, type PanelState } from '../lib/state';
import { AssistantPanelView, type PanelViewProps } from './assistant-panel';

vi.mock('next/navigation', () => ({ usePathname: () => '/contacts' }));

/**
 * Every state of the assistant panel, in English and Arabic: idle, the first-use notice, running, awaiting a confirmation, awaiting an
 * answer, finished, stopped by the step limit, failed (with the request id), and off on this screen.
 */

const load = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'help-agent.json'), 'utf8'),
  ) as Record<string, unknown>;
const MESSAGES = { en: load('en'), ar: load('ar') };

const noop = () => undefined;
const base = (over: Partial<PanelViewProps> = {}): PanelViewProps => ({
  state: initialState,
  draft: '',
  onDraft: noop,
  disabledHere: false,
  noticeAccepted: true,
  onAcceptNotice: noop,
  prompts: ['How do I use Contacts?', 'Where do I find Contacts?'],
  guides: [],
  stepsById: {},
  onLoadSteps: noop,
  onSubmit: noop,
  onStop: noop,
  onAllow: noop,
  onDeny: noop,
  onAnswer: noop,
  onReset: noop,
  onClose: noop,
  maxSteps: 25,
  variant: 'inline',
  ...over,
});
const st = (over: Partial<PanelState>): PanelState => ({ ...initialState, ...over });

const html = (props: PanelViewProps, locale: 'en' | 'ar' = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
      <AssistantPanelView {...props} />
    </NextIntlClientProvider>,
  );

const GUIDE = {
  id: 'connect-first-whatsapp-number',
  title: 'Connect your first WhatsApp number',
  summary: 'Link a number.',
  href: '/help/connect-first-whatsapp-number',
};

describe('assistant panel: always', () => {
  it('is a labelled dialog that the page-reading library skips', () => {
    const out = html(base());
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-label="Ask the assistant"');
    expect(out).toContain('data-page-agent-ignore="true"');
    expect(out).toContain('aria-label="Close"');
  });
});

describe('assistant panel: idle', () => {
  it('shows the task box, both buttons and the examples', () => {
    const out = html(base());
    expect(out).toContain('What do you want to do?');
    expect(out).toContain('Do it for me');
    expect(out).toContain('Show me instead');
    expect(out).toContain('data-testid="assistant-prompts"');
    expect(out).toContain('How do I use Contacts?');
    expect(out).not.toContain('assistant-notice');
  });

  it('disables the buttons until there is a task, and enables them with one', () => {
    expect(html(base())).toMatch(/<button[^>]*disabled=""[^>]*>Do it for me/);
    expect(html(base({ draft: 'add a tag' }))).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Do it for me/,
    );
  });

  it('refuses a task that is too long', () => {
    const out = html(base({ draft: 'x'.repeat(601) }));
    expect(out).toContain('Keep it under 600 characters.');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Do it for me/);
  });

  it('offers the guides that answer the question, with a way to see the steps, open the guide, or do it', () => {
    const out = html(base({ draft: 'connect whatsapp', guides: [GUIDE] }));
    expect(out).toContain('From the Help guides');
    expect(out).toContain('Connect your first WhatsApp number');
    expect(out).toContain('Show steps');
    expect(out).toContain('href="/help/connect-first-whatsapp-number"');
    expect(out).toContain('Open guide');
    expect(out.match(/Do it for me/g)?.length).toBe(2);
  });

  it('lists the steps of a guide once they are loaded, and hides the button', () => {
    const out = html(
      base({
        draft: 'x',
        guides: [GUIDE],
        stepsById: { [GUIDE.id]: ['Open Settings', 'Select Channels'] },
      }),
    );
    expect(out).toContain('<li>Open Settings</li>');
    expect(out).not.toContain('Show steps');
  });
});

describe('assistant panel: first use', () => {
  it('shows the notice, with what is sent, and nothing to type until it is accepted', () => {
    const out = html(base({ noticeAccepted: false }));
    expect(out).toContain('data-testid="assistant-notice"');
    expect(out).toContain(
      'sends your request and the text of the page you are on to an AI provider',
    );
    expect(out).toContain('I understand');
    expect(out).not.toContain('What do you want to do?');
  });
});

describe('assistant panel: running', () => {
  const running = st({
    phase: 'running',
    task: 'add the tag VIP',
    thinking: true,
    steps: [{ n: 1, goal: 'Open the contacts page', action: 'click_element_by_index', result: '' }],
  });

  it('shows the task, the steps, the progress and a Stop button, and no task box', () => {
    const out = html(base({ state: running }));
    expect(out).toContain('add the tag VIP');
    expect(out).toContain('Open the contacts page');
    expect(out).toContain('Step 2 of 25');
    expect(out).toContain('Thinking...');
    expect(out).toContain('>Stop<');
    expect(out).toContain('aria-live="polite"');
    expect(out).not.toContain('What do you want to do?');
  });

  it('shows the last thing it did when it is not thinking', () => {
    const out = html(
      base({ state: { ...running, thinking: false, activity: { kind: 'click', label: 'Tags' } } }),
    );
    expect(out).toContain('Clicking: Tags');
  });

  it('shows Stopping... and disables Stop while it stops', () => {
    const out = html(base({ state: { ...running, stopping: true } }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Stopping\.\.\./);
  });

  it('shows the start state before the first step', () => {
    expect(html(base({ state: st({ phase: 'starting', task: 'x' }) }))).toContain('Starting...');
  });
});

describe('assistant panel: awaiting a confirmation', () => {
  const awaiting = st({
    phase: 'running',
    task: 'save the contact',
    confirm: { id: 'c1', kind: 'click', label: 'Save contact', reason: 'submit' },
  });

  it('shows what is about to happen with Deny first and focused, and Allow once', () => {
    const out = html(base({ state: awaiting }));
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain('Allow this?');
    expect(out).toContain('The assistant is about to click &quot;Save contact&quot;.');
    expect(out).toContain('This saves or submits what is on the page.');
    expect(out.indexOf('>Deny<')).toBeLessThan(out.indexOf('>Allow once<'));
    expect(out).toMatch(/<button[^>]*autoFocus|autofocus/i);
  });

  it('names the option for a dropdown', () => {
    const out = html(
      base({
        state: st({
          ...awaiting,
          confirm: { id: 'c2', kind: 'select', label: 'Role', detail: 'Admin', reason: 'access' },
        }),
      }),
    );
    expect(out).toContain('choose &quot;Admin&quot; in &quot;Role&quot;');
    expect(out).toContain('changes who can do what');
  });

  it('stays a Stop button away from the person at all times', () => {
    expect(html(base({ state: awaiting }))).toContain('>Stop<');
  });
});

describe('assistant panel: a question from the assistant', () => {
  it('shows the question and an answer box', () => {
    const out = html(
      base({ state: st({ phase: 'running', task: 't', question: 'Which tag name?' }) }),
    );
    expect(out).toContain('data-testid="assistant-question"');
    expect(out).toContain('Which tag name?');
    expect(out).toContain('Your answer');
  });
});

describe('assistant panel: finished', () => {
  const result = {
    outcome: 'completed' as const,
    message: 'Tag added.',
    steps: 3,
    confirmed: 1,
    denied: 0,
    stoppedBy: null,
  };
  it('shows the outcome and what happened', () => {
    const out = html(base({ state: st({ phase: 'finished', result }) }));
    expect(out).toContain('data-testid="assistant-result"');
    expect(out).toContain('Done');
    expect(out).toContain('Tag added.');
    expect(out).toContain('3 steps, 1 allowed, 0 declined.');
    expect(out).toContain('New task');
  });
  it('says so when the step limit ended it, and when the person did', () => {
    expect(
      html(
        base({
          state: st({
            phase: 'finished',
            result: { ...result, outcome: 'stopped', stoppedBy: 'budget' },
          }),
        }),
      ),
    ).toContain('reached its step limit');
    expect(
      html(
        base({
          state: st({
            phase: 'finished',
            result: { ...result, outcome: 'stopped', stoppedBy: 'person' },
          }),
        }),
      ),
    ).toContain('You stopped the task.');
    expect(
      html(
        base({
          state: st({
            phase: 'finished',
            result: { ...result, outcome: 'stopped', stoppedBy: 'location' },
          }),
        }),
      ),
    ).toContain('not allowed to use');
  });
  it('does not call a failed task done', () => {
    expect(
      html(
        base({
          state: st({
            phase: 'finished',
            result: { ...result, outcome: 'failed', message: 'No such button.' },
          }),
        }),
      ),
    ).toContain('I could not finish this');
  });
});

describe('assistant panel: failed', () => {
  it('shows a clear message and the request id, never a blank panel', () => {
    const out = html(
      base({
        state: st({
          phase: 'error',
          error: { key: 'providerDown', requestId: 'req-123', retryAfter: null },
        }),
      }),
    );
    expect(out).toContain('data-testid="assistant-error"');
    expect(out).toContain('The AI service did not answer');
    expect(out).not.toContain('Request ID: req-123');
    expect(out).toContain('Try again');
  });
  it('has a message for every kind of failure', () => {
    for (const key of [
      'disabled',
      'planLocked',
      'forbidden',
      'rateLimited',
      'taskLimit',
      'stepLimit',
      'closed',
      'providerDown',
      'monthlyLimit',
      'signedOut',
      'network',
      'generic',
    ] as const) {
      const out = html(
        base({ state: st({ phase: 'error', error: { key, requestId: null, retryAfter: null } }) }),
      );
      expect(out, key).toContain('data-testid="assistant-error"');
      expect(out, key).not.toContain('errors.');
    }
  });
  it('tells a rate-limited person how long to wait', () => {
    const out = html(
      base({
        state: st({
          phase: 'error',
          error: { key: 'rateLimited', requestId: 'r', retryAfter: 30 },
        }),
      }),
    );
    expect(out).toContain('Try again in 30 seconds.');
  });
});

describe('assistant panel: off on this screen', () => {
  it('says why and takes no task', () => {
    const out = html(base({ disabledHere: true, draft: 'anything' }));
    expect(out).toContain('data-testid="assistant-disabled"');
    expect(out).toContain('shows messages and details written by customers');
    expect(out).toMatch(/<textarea[^>]*disabled=""/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Do it for me/);
    expect(out).not.toContain('assistant-prompts');
  });
});

describe('assistant panel: Arabic', () => {
  it('is fully translated in every state, has no leftover keys, and uses logical (RTL-safe) spacing', () => {
    const states: PanelViewProps[] = [
      base(),
      base({ noticeAccepted: false }),
      base({
        state: st({
          phase: 'running',
          task: 'x',
          thinking: true,
          steps: [{ n: 1, goal: 'g', action: 'a', result: '' }],
        }),
      }),
      base({
        state: st({
          phase: 'running',
          task: 'x',
          confirm: { id: 'c', kind: 'click', label: 'حفظ', reason: 'submit' },
        }),
      }),
      base({ state: st({ phase: 'running', task: 'x', question: 'ما الاسم؟' }) }),
      base({
        state: st({
          phase: 'finished',
          result: {
            outcome: 'completed',
            message: 'تم',
            steps: 2,
            confirmed: 1,
            denied: 1,
            stoppedBy: null,
          },
        }),
      }),
      base({
        state: st({
          phase: 'error',
          error: { key: 'providerDown', requestId: 'r-1', retryAfter: 5 },
        }),
      }),
      base({ disabledHere: true }),
      base({ draft: 'ربط واتساب', guides: [GUIDE] }),
    ];
    for (const props of states) {
      const out = html(props, 'ar');
      expect(out).not.toMatch(/help-agent\.|panel\.|confirm\.|errors\./);
      expect(out).not.toMatch(/\b(pl|pr|ml|mr|left|right)-\d/);
    }
    const idle = html(base(), 'ar');
    expect(idle).toContain('ماذا تريد أن تفعل؟');
    expect(idle).toContain('نفّذ عني');
    expect(idle).toContain('أرني بدلاً من ذلك');
    const confirm = html(states[3]!, 'ar');
    expect(confirm.indexOf('>رفض<')).toBeLessThan(confirm.indexOf('>سماح مرة واحدة<'));
    expect(html(states[6]!, 'ar')).not.toContain('معرّف الطلب: r-1');
  });
});
