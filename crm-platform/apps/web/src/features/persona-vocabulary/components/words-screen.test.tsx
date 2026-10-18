// @vitest-environment jsdom
import type { WorkspaceVocabularyResponse } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { button, click, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  words: {} as Record<string, unknown>,
  save: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('../api/hooks', () => ({
  KEYS: {
    all: ['persona-vocabulary'],
    words: (l: string) => ['persona-vocabulary', 'words', l],
  },
  useWorkspaceWords: () => state.words,
}));
vi.mock('../api/service', () => ({
  vocabularyApi: { save: (locale: string, body: unknown) => state.save(locale, body) },
}));

import { WordsScreen } from './words-screen';

type Row = WorkspaceVocabularyResponse['nouns'][number];
const row = (noun: Row['noun'], over: Partial<Row> = {}): Row => ({
  noun,
  effective: null,
  source: 'default',
  workspace: null,
  workspaceLocales: [],
  ...over,
});
const response = (
  over: Partial<WorkspaceVocabularyResponse> = {},
  rows: Row[] = [row('contact'), row('appointment'), row('deal'), row('meeting')],
): WorkspaceVocabularyResponse => ({
  locale: 'en',
  rev: 4,
  personaKey: 'generic',
  nouns: rows,
  ...over,
});
const ok = (data: unknown) => ({ isError: false, error: null, data, refetch: vi.fn() });

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['admin.settings.manage']);
  state.words = ok(response());
  state.save.mockReset().mockResolvedValue(response({ rev: 5 }));
  state.refresh.mockReset();
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

const input = (host: HTMLElement, id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;

describe('Words we use screen', () => {
  it('lists the four nouns with the product word as the placeholder, and nothing to save', async () => {
    m = await mount(<WordsScreen />);
    const h = m.host;
    expect(h.textContent).toContain(text('title'));
    expect(input(h, 'noun-contact-one').placeholder).toBe('Contact');
    expect(input(h, 'noun-contact-other').placeholder).toBe('Contacts');
    expect(input(h, 'noun-appointment-one').placeholder).toBe('Appointment');
    expect(input(h, 'noun-deal-other').placeholder).toBe('Deals');
    expect(input(h, 'noun-meeting-one').placeholder).toBe('Meeting');
    expect(h.textContent).toContain(text('source.default'));
    expect(button(h, text('save')).disabled).toBe(true);
    // the promise that only labels change is on the page
    expect(h.textContent).toContain(text('labelsOnly'));
  });

  it('saves the changed noun for the language being edited, with the revision it read, then refreshes the layout', async () => {
    m = await mount(<WordsScreen />);
    const h = m.host;
    await type(input(h, 'noun-contact-one'), 'Patient');
    await type(input(h, 'noun-contact-other'), 'Patients');
    const save = button(h, text('save'));
    expect(save.disabled).toBe(false);
    await click(save);
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save).toHaveBeenCalledWith('en', {
      rev: 4,
      nouns: { contact: { en: { one: 'Patient', other: 'Patients' } } },
    });
    expect(state.refresh).toHaveBeenCalled();
    expect(h.textContent).toContain(text('saved'));
  });

  it('asks for both forms and refuses text an ICU message would read as syntax', async () => {
    m = await mount(<WordsScreen />);
    const h = m.host;
    await type(input(h, 'noun-deal-one'), 'Admission');
    expect(h.textContent).toContain(text('problems.incomplete'));
    expect(button(h, text('save')).disabled).toBe(true);
    await type(input(h, 'noun-deal-other'), '{count} admissions');
    expect(h.textContent).toContain(text('problems.invalid'));
    expect(button(h, text('save')).disabled).toBe(true);
    await type(input(h, 'noun-deal-other'), 'Admissions');
    expect(button(h, text('save')).disabled).toBe(false);
  });

  it('"every language" sends the same words for all 21 languages', async () => {
    m = await mount(<WordsScreen />);
    const h = m.host;
    await type(input(h, 'noun-meeting-one'), 'Consult');
    await type(input(h, 'noun-meeting-other'), 'Consults');
    await click(h.querySelector('#apply-all')!);
    await click(button(h, text('save')));
    const body = state.save.mock.calls[0]![1] as {
      nouns: { meeting: Record<string, unknown> };
    };
    expect(Object.keys(body.nouns.meeting)).toHaveLength(21);
    expect(body.nouns.meeting['hi']).toEqual({ one: 'Consult', other: 'Consults' });
  });

  it('shows who set a word, starts from it and offers a reset only for the workspace’s own', async () => {
    state.words = ok(
      response({}, [
        row('contact', {
          effective: { one: 'Patient', other: 'Patients' },
          source: 'persona',
        }),
        row('appointment', {
          effective: { one: 'Visit', other: 'Visits' },
          source: 'workspace',
          workspace: { one: 'Visit', other: 'Visits' },
          workspaceLocales: ['en'],
        }),
        row('deal'),
        row('meeting', { effective: { one: 'Call', other: 'Calls' }, source: 'operator' }),
      ]),
    );
    m = await mount(<WordsScreen />);
    const h = m.host;
    expect(h.textContent).toContain(text('source.persona'));
    expect(h.textContent).toContain(text('source.workspace'));
    expect(h.textContent).toContain(text('source.operator'));
    expect(input(h, 'noun-contact-one').value).toBe('Patient');
    expect(input(h, 'noun-meeting-other').value).toBe('Calls');
    // nothing was edited, so nothing to save; exactly one row has its own words to reset
    expect(button(h, text('save')).disabled).toBe(true);
    expect(h.querySelectorAll('button')).toBeDefined();
    const resets = [...h.querySelectorAll('button')].filter((b) => b.textContent === text('reset'));
    expect(resets).toHaveLength(1);
    await click(resets[0]!);
    expect(state.save).toHaveBeenCalledWith('en', { rev: 4, nouns: { appointment: null } });
  });

  it('says so when someone else saved first, without losing the page', async () => {
    state.save.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'conflict'));
    m = await mount(<WordsScreen />);
    const h = m.host;
    await type(input(h, 'noun-contact-one'), 'Client');
    await type(input(h, 'noun-contact-other'), 'Clients');
    await click(button(h, text('save')));
    expect(h.textContent).toContain(text('conflict'));
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('shows another error from the server by its code', async () => {
    state.save.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'nope'));
    m = await mount(<WordsScreen />);
    const h = m.host;
    await type(input(h, 'noun-contact-one'), 'Client');
    await type(input(h, 'noun-contact-other'), 'Clients');
    await click(button(h, text('save')));
    expect(h.textContent).toContain(text('errors.validation'));
  });

  it('a person without the permission sees no form', async () => {
    state.perms = new Set();
    m = await mount(<WordsScreen />);
    expect(m.host.textContent).toContain(text('errors.forbidden'));
    expect(m.host.querySelector('input')).toBeNull();
  });

  it('a language with one word for both numbers asks for one word', async () => {
    state.words = ok(response({ locale: 'ja' }));
    m = await mount(<WordsScreen />, { locale: 'ja' });
    const h = m.host;
    expect(input(h, 'noun-contact-one').placeholder).toBe('連絡先');
    expect(h.querySelector('#noun-contact-other')).toBeNull();
    await type(input(h, 'noun-contact-one'), '患者');
    await click(button(h, text('save', 'ja')));
    expect(state.save).toHaveBeenCalledWith('ja', {
      rev: 4,
      nouns: { contact: { ja: { one: '患者', other: '患者' } } },
    });
  });

  it('warns where one word covers appointments and meetings', async () => {
    state.words = ok(response({ locale: 'pl' }));
    m = await mount(<WordsScreen />, { locale: 'pl' });
    const warnings = [...m.host.querySelectorAll('[role="alert"]')].filter(
      (e) => e.textContent === text('sharedWord', 'pl'),
    );
    // appointment and meeting both
    expect(warnings).toHaveLength(2);
  });

  it('renders in Arabic with Arabic copy and no raw message keys', async () => {
    state.words = ok(response({ locale: 'ar' }));
    m = await mount(<WordsScreen />, { locale: 'ar' });
    expect(m.host.textContent).toContain(text('title', 'ar'));
    expect(m.host.textContent).not.toMatch(/persona-vocabulary\./);
  });
});
