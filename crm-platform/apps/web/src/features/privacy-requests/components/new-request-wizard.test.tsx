// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, makeRequest, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  hits: [] as unknown[],
  create: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('../api/hooks', () => ({
  KEYS: { all: ['privacy-requests'] },
  useSubjectSearch: (q: string) => ({
    data: q.trim().length >= 2 ? { data: state.hits } : undefined,
    isFetching: false,
  }),
}));
vi.mock('../api/service', () => ({
  privacyApi: { create: (i: unknown) => state.create(i) },
}));

import { NewRequestWizard } from './new-request-wizard';

let m: Mounted | null = null;
beforeEach(() => {
  state.hits = [
    {
      kind: 'contact',
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Amina Khan',
      hint: '••• 4821',
    },
  ];
  state.create.mockReset().mockResolvedValue(makeRequest());
  state.push.mockReset();
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe.each(['en', 'ar'])('new request wizard (%s)', (locale) => {
  it('walks person, type, details and creates an erasure request with the history choice', async () => {
    m = await mount(<NewRequestWizard open onClose={vi.fn()} />, { locale });
    const h = m.host;
    const next = () => button(h, text('common.next', locale));
    expect(next().disabled).toBe(true);

    await type(h.querySelector<HTMLInputElement>('#privacy-subject-search')!, 'Ami');
    expect(h.textContent).toContain('Amina Khan');
    expect(h.textContent).toContain('••• 4821');
    await click(button(h, text('wizard.person.pick', locale).replace('{name}', 'Amina Khan')));
    expect(next().disabled).toBe(false);
    await click(next());

    expect(next().disabled).toBe(true);
    await click(h.querySelector('#privacy-type-erasure')!);
    await click(next());

    await click(h.querySelector('#privacy-history-anonymise')!);
    await type(h.querySelector<HTMLTextAreaElement>('#privacy-note')!, 'asked by email');
    await click(button(h, text('wizard.create', locale)));
    await act(async () => undefined);

    expect(state.create).toHaveBeenCalledWith({
      requestType: 'erasure',
      subject: { kind: 'contact', id: '22222222-2222-4222-8222-222222222222' },
      requesterChannel: 'staff',
      internalNote: 'asked by email',
      historyMode: 'anonymise',
    });
    expect(state.push).toHaveBeenCalledWith(
      '/privacy-requests/11111111-1111-4111-8111-111111111111',
    );
  });

  it('accepts a phone or an email for someone who is not in the contacts', async () => {
    m = await mount(<NewRequestWizard open onClose={vi.fn()} />, { locale });
    const h = m.host;
    await type(h.querySelector<HTMLInputElement>('#privacy-subject-other')!, 'sara@example.com');
    await click(button(h, text('wizard.person.useOther', locale)));
    await click(button(h, text('common.next', locale)));
    await click(h.querySelector('#privacy-type-access')!);
    await click(button(h, text('common.next', locale)));
    // The history choice only exists for an erasure.
    expect(h.querySelector('#privacy-history-delete')).toBeNull();
    await click(button(h, text('wizard.create', locale)));
    await act(async () => undefined);
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'access',
        subject: { kind: 'identifier', identifierKind: 'email', value: 'sara@example.com' },
        historyMode: 'delete',
      }),
    );
  });
});
