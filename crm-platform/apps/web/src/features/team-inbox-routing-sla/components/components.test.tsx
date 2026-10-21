import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { U1, U2, rule } from '../lib/fixtures';
import { readAllMessages } from '../lib/test-support';
import { RuleRow } from './auto-assignment-screen';
import { RuleFormBody } from './rule-form-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/auto-assignment',
}));

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={readAllMessages(locale)}
      timeZone="UTC"
      now={new Date('2026-10-06T12:00:00Z')}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const noop = () => undefined;
const names = new Map([
  [U1, 'Asha Rao'],
  [U2, 'Bilal Khan'],
]);

function row(
  over: Parameters<typeof rule>[0] = {},
  props: Partial<Parameters<typeof RuleRow>[0]> = {},
) {
  return html(
    <ol>
      <RuleRow
        rule={rule(over)}
        index={0}
        last={false}
        searching={false}
        names={names}
        busy={false}
        canManage
        onToggle={noop}
        onMove={noop}
        onDuplicate={noop}
        onDelete={noop}
        {...props}
      />
    </ol>,
  );
}

describe('a rule in the list', () => {
  it('shows its priority, name, what it matches, who gets it and how often it was used', () => {
    const out = row();
    expect(out).toContain('Refund requests');
    expect(out).toContain('Billing agents take refunds');
    // one readable sentence: when, then how
    expect(out).toContain(
      'Channel: WhatsApp Cloud API, Message has any of: refund, invoice → Round robin: Asha Rao, Bilal Khan',
    );
    expect(out).toContain('Used 12 times');
    expect(out).toContain('last on');
  });

  it('flags a rule that keeps checking and agents that are gone', () => {
    const out = row({ stopOnMatch: false, unavailableTargets: 2 });
    expect(out).toContain('Keeps checking');
    expect(out).toContain('2 agents unavailable');
  });

  it('a rule that applies to every conversation says so whatever conditions it keeps (H13)', () => {
    const out = row({ appliesToAll: true });
    expect(out).toContain('Every new conversation → Round robin: Asha Rao, Bilal Khan');
    expect(out).not.toContain('Channel: WhatsApp Cloud API');
  });

  it('warns on a rule an earlier catch-all blocks, and on one that can never match (H17)', () => {
    expect(row({}, { shadowed: true })).toContain('Never runs');
    const never = row({
      appliesToAll: false,
      conditions: { ...rule().conditions, channelKinds: [], keywords: null },
    });
    expect(never).toContain('Never matches');
  });

  it('shows the everyone pool as "all agents"', () => {
    const out = row({
      appliesToAll: true,
      assign: { strategy: 'least_busy', userIds: [], teamIds: [], everyone: true },
    });
    expect(out).toContain('Least busy: all agents');
  });

  it('a rule that never fired says so, and an unknown agent is not shown by id', () => {
    const out = row({ firedCount: 0, lastFiredAt: null }, { names: new Map() });
    expect(out).toContain('Not used yet');
    expect(out).toContain('an agent');
    expect(out).not.toContain(U1);
  });

  it('priority arrows are off at the edges and while searching; a reader sees no controls', () => {
    const first = row({}, {});
    expect(first).toMatch(/aria-label="Move Refund requests up"[^>]*disabled/);
    expect(first).not.toMatch(/aria-label="Move Refund requests down"[^>]*disabled/);
    expect(row({}, { searching: true })).toMatch(
      /aria-label="Move Refund requests down"[^>]*disabled/,
    );
    const ro = row({}, { canManage: false });
    expect(ro).not.toContain('Edit');
    expect(ro).not.toContain('Delete');
    expect(ro).not.toContain('role="switch"');
  });

  it('is available in Arabic', () => {
    const out = html(
      <ol>
        <RuleRow
          rule={rule()}
          index={0}
          last
          searching={false}
          names={names}
          busy={false}
          canManage
          onToggle={noop}
          onMove={noop}
          onDuplicate={noop}
          onDelete={noop}
        />
      </ol>,
      'ar',
    );
    expect(out).toContain('بالتناوب');
    expect(out).toContain('تعديل');
  });
});

describe('the rule form', () => {
  it('a new rule offers Save and Save and activate, the strategies and the options', () => {
    const out = html(<RuleFormBody />);
    expect(out).toContain('Create rule');
    expect(out).toContain('Rule name');
    expect(out).toContain('Description');
    expect(out).toContain('Round robin');
    expect(out).toContain('Least busy');
    expect(out).toContain('A specific agent');
    expect(out).toContain('Stop when this rule matches');
    expect(out).toContain('>Save<');
    expect(out).toContain('Save and activate');
    // no condition is shown until the admin asks for one: the switch is off and the rule applies to every conversation
    expect(out).toContain('Only for conversations that match...');
    expect(out).toContain('This rule applies to every new conversation.');
    expect(out).not.toContain('Message words');
    expect(out).not.toContain('data-testid="add-condition"');
    expect(out).not.toContain('Fallback rule');
  });

  it('a rule with conditions shows only those, each as a card, with the add menu', () => {
    const out = html(<RuleFormBody rule={rule()} />);
    expect(out).toContain('Message words');
    expect(out).toContain('Channel');
    expect(out).toContain('data-testid="add-condition"');
    expect(out).not.toContain('Customer language');
    expect(out).not.toContain('New or returning contact');
    // the channel checkboxes are inside the Channel card only when it was added
    expect(html(<RuleFormBody />)).not.toContain('Telegram');
  });

  it('a rule that applies to every conversation keeps its conditions but says they are ignored', () => {
    const out = html(<RuleFormBody rule={rule({ appliesToAll: true })} />);
    expect(out).toContain('Your conditions are kept but ignored while this is off.');
    expect(out).not.toContain('data-testid="add-condition"');
  });

  it('Everyone else has no When card and can share over all agents', () => {
    const out = html(<RuleFormBody everyoneElse />);
    expect(out).not.toContain('Only for conversations that match');
    expect(out).not.toContain('Stop when this rule matches');
    expect(out).toContain('Everyone who can open the inbox');
    expect(out).toContain('value="Everyone else"');
  });

  it('an active rule is edited with Save only, and its values are in the form', () => {
    const out = html(<RuleFormBody rule={rule()} />);
    expect(out).toContain('Edit rule');
    expect(out).toContain('value="Refund requests"');
    expect(out).toContain('refund, invoice');
    expect(out).not.toContain('Save and activate');
  });

  it('an inactive rule can still be saved and activated', () => {
    expect(html(<RuleFormBody rule={rule({ isActive: false })} />)).toContain('Save and activate');
  });
});
