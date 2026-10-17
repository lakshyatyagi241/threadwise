// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { HOT_FROM } from '@/features/lead-scoring';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import type { ContactRow } from '../../api/schemas';
import { LeadScoreChip } from './lead-score-chip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (perms: string[]) =>
  ({
    user: { id: 'u', email: 'a@x.test', fullName: 'Asha Rao', displayName: null },
    org: { timezone: 'UTC' },
    permissions: Object.fromEntries(perms.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

const contact = (over: Partial<ContactRow> = {}) =>
  ({
    id: '294dca7c-5806-4548-9035-dcca9befc7b1',
    name: 'Lakshya Tyagi',
    leadScore: 78,
    leadScoreSource: 'ai',
    ...over,
  }) as unknown as ContactRow;

let host: HTMLElement;
let root: Root;

function mount(
  ui: ReactNode,
  {
    perms = ['record.contacts.read'],
    features = ['lead_scoring'] as string[] | null,
    locale = 'en',
  } = {},
) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
        <SessionProvider session={session(perms)}>
          <PlanFeaturesProvider features={features}>{ui}</PlanFeaturesProvider>
        </SessionProvider>
      </NextIntlClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const chip = () => host.querySelector<HTMLElement>('[data-testid="lead-score-chip"]');

describe('LeadScoreChip', () => {
  it('shows a star and the number, with the band in the tooltip and the accessible name', () => {
    mount(<LeadScoreChip contact={contact()} onOpen={() => undefined} />);
    expect(chip()?.textContent).toBe('78');
    expect(chip()?.querySelector('svg')).not.toBeNull();
    expect(chip()?.title).toBe('Lead score 78 · Hot lead');
    expect(chip()?.getAttribute('aria-label')).toBe(
      'Lead score 78, Hot lead. Show the score details.',
    );
  });

  it('is coloured by band from the lead-scoring thresholds, not from numbers of its own', () => {
    const tone = (score: number) => {
      mount(<LeadScoreChip contact={contact({ leadScore: score })} />);
      const out = { band: chip()?.dataset.band, cls: chip()?.className ?? '' };
      act(() => root.unmount());
      host.remove();
      return out;
    };
    const hot = tone(HOT_FROM);
    const warm = tone(HOT_FROM - 1);
    const cold = tone(0);
    expect([hot.band, warm.band, cold.band]).toEqual(['hot', 'warm', 'cold']);
    expect(hot.cls).toContain('text-success');
    expect(warm.cls).toContain('text-warning');
    expect(cold.cls).toContain('text-muted-foreground');
    // a plain chip (no handler) is not a button
    mount(<LeadScoreChip contact={contact()} />);
    expect(chip()?.tagName).toBe('SPAN');
    expect(chip()?.getAttribute('role')).toBe('img');
  });

  it('is a button that asks for the Lead score card', () => {
    const onOpen = vi.fn();
    mount(<LeadScoreChip contact={contact()} onOpen={onOpen} />);
    expect(chip()?.tagName).toBe('BUTTON');
    act(() => chip()?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('draws nothing (no empty chip) for a contact that has no score yet', () => {
    mount(<LeadScoreChip contact={contact({ leadScore: null })} onOpen={() => undefined} />);
    expect(host.innerHTML).toBe('');
  });

  it('draws nothing for someone who may not read contacts', () => {
    mount(<LeadScoreChip contact={contact()} onOpen={() => undefined} />, { perms: [] });
    expect(host.innerHTML).toBe('');
  });

  it('draws nothing when the workspace has no AI lead scoring and the AI wrote the score', () => {
    mount(<LeadScoreChip contact={contact()} onOpen={() => undefined} />, { features: ['inbox'] });
    expect(host.innerHTML).toBe('');
  });

  it('keeps a score a person typed when the workspace has no AI lead scoring (it is part of the contact)', () => {
    mount(
      <LeadScoreChip contact={contact({ leadScoreSource: 'manual' })} onOpen={() => undefined} />,
      { features: ['inbox'] },
    );
    expect(chip()?.textContent).toBe('78');
  });

  it('shows the chip when the plan features are not known yet (nothing is hidden on a guess)', () => {
    mount(<LeadScoreChip contact={contact()} onOpen={() => undefined} />, { features: null });
    expect(chip()?.textContent).toBe('78');
  });

  it('reads in Arabic with the band in Arabic', () => {
    mount(<LeadScoreChip contact={contact()} onOpen={() => undefined} />, { locale: 'ar' });
    expect(chip()?.title).toMatch(/78/);
    expect(chip()?.title).not.toMatch(/Hot lead|Lead score/);
  });
});
