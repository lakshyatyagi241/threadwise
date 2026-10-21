// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderPack, ReminderPackAdoptResult, ReminderPackPreview } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { PlanFeaturesProvider } from '@/lib/plan-features';

const api = vi.hoisted(() => ({
  packs: vi.fn(),
  previewPack: vi.fn(),
  adoptPack: vi.fn(),
}));
vi.mock('../api/sequences-service', () => ({ sequencesApi: api }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({ user: {}, org: {} }),
}));

import { ReminderPackDialog } from './reminder-pack-dialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no <dialog> methods
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const stepOf = (stepKind: string, kind: string, offsetMinutes: number, over = {}) => ({
  stepKind,
  kind,
  offsetMinutes,
  isActive: true,
  channels: ['whatsapp', 'email'],
  buttons: false,
  skipIfConfirmed: false,
  onlineOnly: false,
  metaCategory: 'UTILITY',
  messageKind: 'reminder',
  ...over,
});

const PACKS = [
  {
    key: 'clinic',
    version: 1,
    name: 'Clinic and doctor',
    description: 'Confirmation and reminders for a practice.',
    languages: ['en', 'hi'],
    machineDrafted: ['hi'],
    steps: [stepOf('confirmation', 'event', 0), stepOf('reminder_24h', 'before', 1440)],
  },
  {
    key: 'salon_spa',
    version: 1,
    name: 'Salon and spa',
    description: 'For salons.',
    languages: ['en', 'hi'],
    machineDrafted: ['hi'],
    steps: [stepOf('confirmation', 'event', 0)],
  },
] as unknown as ReminderPack[];

const previewStep = (
  stepKind: string,
  kind: string,
  offsetMinutes: number,
  action: 'add' | 'replace' | 'unchanged',
  status: string,
  over: Record<string, unknown> = {},
) => ({
  step: stepOf(stepKind, kind, offsetMinutes, over),
  action,
  existing:
    action === 'replace' ? { id: 'r1', isActive: true, offsetMinutes, hasOwnText: true } : null,
  email: {
    subject: 'Your {{type}} is confirmed',
    body: 'Hi {{name}}, on {{date}} at {{time}}. {{manage_link}}',
  },
  whatsapp: {
    templateName: `appt_clinic_${stepKind}_en`,
    body: 'Hi {{name}}, your {{type}} is on {{date}}.',
    status,
    buttons: stepKind === 'reminder_24h' ? ['Confirm', 'Reschedule', 'Cancel'] : [],
  },
});

const preview = (over: Partial<ReminderPackPreview> = {}, replace = false): ReminderPackPreview =>
  ({
    pack: PACKS[0],
    language: 'en',
    bookingType: { id: 'type-1', name: 'Check-up', online: false },
    steps: [
      previewStep('confirmation', 'event', 0, 'add', 'new'),
      previewStep('reminder_24h', 'before', 1440, replace ? 'replace' : 'add', 'pending', {
        buttons: true,
      }),
    ],
    kept: [],
    timedSteps: 1,
    timedStepsMax: 5,
    blocked: null,
    needsConfirm: replace,
    ...over,
  }) as unknown as ReminderPackPreview;

const RESULT: ReminderPackAdoptResult = {
  reminders: [],
  templates: [
    { name: 'appt_clinic_reminder_24h_en', status: 'pending', created: true, metaError: null },
    {
      name: 'appt_clinic_confirmation_en',
      status: 'draft',
      created: true,
      metaError: 'Name already used',
    },
  ],
  added: 2,
  replaced: 0,
};

let root: Root;
let onApplied: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

function mount(over: { dirty?: boolean; canEdit?: boolean; features?: string[] | null } = {}) {
  onApplied = vi.fn();
  onClose = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          <PlanFeaturesProvider features={over.features ?? null}>
            <ReminderPackDialog
              open
              onClose={onClose}
              type={{ id: 'type-1', name: 'Check-up' }}
              dirty={over.dirty ?? false}
              canEdit={over.canEdit ?? true}
              onApplied={onApplied}
            />
          </PlanFeaturesProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

/** Lets the queries and their re-renders finish (react-query resolves over a few ticks). */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
};
const buttons = () => [...document.querySelectorAll('button')];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
const pick = async (name: string) => {
  click(buttons().find((b) => b.getAttribute('role') === 'radio' && b.textContent?.includes(name)));
  await flush();
};
const applyButton = () => byText('Apply sequence') as HTMLButtonElement;

beforeEach(() => {
  api.packs.mockReset().mockResolvedValue(PACKS);
  api.previewPack.mockReset().mockResolvedValue(preview());
  api.adoptPack.mockReset().mockResolvedValue(RESULT);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the reminder pack dialog', () => {
  it('lists the packs and holds Apply until one is chosen', async () => {
    mount();
    await flush();
    expect(document.body.textContent).toContain('Clinic and doctor');
    expect(document.body.textContent).toContain('Salon and spa');
    expect(applyButton().disabled).toBe(true);
    expect(api.previewPack).not.toHaveBeenCalled();
  });

  it('previews the chosen pack in English, with sample values and the template state', async () => {
    mount();
    await flush();
    await pick('Clinic and doctor');
    expect(api.previewPack).toHaveBeenCalledWith(
      'clinic',
      { bookingTypeId: 'type-1', language: 'en' },
      expect.anything(),
    );
    const text = document.body.textContent!;
    expect(text).toContain('Booking confirmation');
    expect(text).toContain('24 hour reminder');
    expect(text).toContain('1 day before it starts');
    expect(text).toContain('Will be sent to Meta');
    expect(text).toContain('Waiting for Meta approval');
    expect(text).toContain('2 to add, 0 to replace, 0 already the same');
    // the messages are behind a toggle, filled with the sample values; a clinic never names the service
    click(byText('Show messages'));
    const body = document.body.textContent!;
    expect(body).toContain('Hi Alex, on Tuesday, 15 January at 10:00 AM.');
    expect(body).toContain('Hi Alex, your appointment is on Tuesday, 15 January.');
    expect(body).not.toContain('{{name}}');
    expect(body).toContain('appt_clinic_confirmation_en');
    expect(applyButton().disabled).toBe(false);
  });

  it('asks again in Hindi, with the machine-draft warning and Hindi sample values', async () => {
    mount();
    await flush();
    await pick('Clinic and doctor');
    expect(document.body.textContent).not.toContain('machine-made draft');
    api.previewPack.mockResolvedValue(preview({ language: 'hi' }));
    click(buttons().find((b) => b.getAttribute('role') === 'radio' && b.textContent === 'हिन्दी'));
    await flush();
    expect(api.previewPack).toHaveBeenLastCalledWith(
      'clinic',
      { bookingTypeId: 'type-1', language: 'hi' },
      expect.anything(),
    );
    expect(document.body.textContent).toContain('machine-made draft');
    click(byText('Show messages'));
    expect(document.body.textContent).toContain('आर्यन');
  });

  it('lets the owner edit the sample values', async () => {
    mount();
    await flush();
    await pick('Salon and spa');
    click(byText('Sample values'));
    const input = [...document.querySelectorAll('input')].find((i) => i.value === 'Alex')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Priyanka',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText('Show messages'));
    expect(document.body.textContent).toContain('Hi Priyanka');
  });

  it('applies a pack, then shows the approval state of every template', async () => {
    mount();
    await flush();
    await pick('Clinic and doctor');
    click(applyButton());
    await flush();
    expect(api.adoptPack).toHaveBeenCalledWith(
      'clinic',
      { bookingTypeId: 'type-1', language: 'en', confirmReplace: false, submitToMeta: true },
      expect.any(String),
    );
    expect(onApplied).toHaveBeenCalled();
    const text = document.body.textContent!;
    expect(text).toContain('The sequence is applied');
    expect(text).toContain('appt_clinic_reminder_24h_en');
    expect(text).toContain('Meta refused it: Name already used');
    expect(text).toContain('goes out by email');
  });

  it('can leave the WhatsApp messages as drafts', async () => {
    mount();
    await flush();
    await pick('Clinic and doctor');
    click(document.getElementById('pack-submit'));
    click(applyButton());
    await flush();
    expect(api.adoptPack.mock.calls[0]![1]).toMatchObject({ submitToMeta: false });
  });

  it("will not replace the owner's steps until it is confirmed", async () => {
    api.previewPack.mockResolvedValue(preview({}, true));
    mount();
    await flush();
    await pick('Clinic and doctor');
    expect(document.body.textContent).toContain('This replaces steps you already have');
    expect(document.body.textContent).toContain('You wrote your own text for this step');
    expect(applyButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('Tick Replace them to continue');
    click(document.getElementById('pack-confirm'));
    expect(applyButton().disabled).toBe(false);
    click(applyButton());
    await flush();
    expect(api.adoptPack.mock.calls[0]![1]).toMatchObject({ confirmReplace: true });
  });

  it('is blocked over the cap of five steps with a time', async () => {
    api.previewPack.mockResolvedValue(preview({ blocked: 'cap_exceeded', timedSteps: 7 }));
    mount();
    await flush();
    await pick('Clinic and doctor');
    expect(document.body.textContent).toContain('would pass the limit of 5 steps with a time');
    expect(applyButton().disabled).toBe(true);
  });

  it('holds Apply while the steps have unsaved changes, and for a viewer', async () => {
    mount({ dirty: true });
    await flush();
    await pick('Clinic and doctor');
    expect(applyButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('Save or discard your changes');
    act(() => root.unmount());
    document.body.innerHTML = '';
    mount({ canEdit: false });
    await flush();
    await pick('Clinic and doctor');
    expect(applyButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('but not apply them');
  });

  it('shows the plan limits as hints and not as hidden controls', async () => {
    api.previewPack.mockResolvedValue(
      preview({
        steps: [
          previewStep('reminder_24h', 'before', 1440, 'add', 'new', { buttons: true }),
          previewStep('rebook', 'after', 90 * 1440, 'add', 'new', { isActive: false }),
        ] as never,
      }),
    );
    mount({ features: ['appointment_booking'] });
    await flush();
    await pick('Clinic and doctor');
    expect(document.body.textContent).toContain('does not include rebook messages');
    expect(document.body.textContent).toContain('does not include the reply buttons');
    expect(document.querySelector('a[href="/account/plans"]')).not.toBeNull();
  });

  it('reloads the preview when the server says a step would be replaced', async () => {
    api.adoptPack.mockRejectedValue(new ApiError(409, ERROR_CODES.CONFLICT, 'conflict'));
    mount();
    await flush();
    await pick('Clinic and doctor');
    click(applyButton());
    await flush();
    expect(document.body.textContent).toContain('needs your confirmation');
    expect(api.previewPack.mock.calls.length).toBeGreaterThan(1);
  });
});
