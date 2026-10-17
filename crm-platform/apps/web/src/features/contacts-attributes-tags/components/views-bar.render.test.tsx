import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { DEFAULT_FILTERS } from '../api/contacts';
import { ViewsBar } from './views-bar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

/** The quick chips under the toolbar: "Hot leads" filters by the lead score, so it is there only while lead scoring is on. */
const draw = (scoring: 'on' | 'off' | 'unknown') =>
  renderAccount(
    <ToastProvider dismissLabel="Dismiss">
      <ViewsBar
        filters={DEFAULT_FILTERS}
        defaultLimit={DEFAULT_FILTERS.limit}
        activeId=""
        columnIds={['name']}
        keepsColumns={false}
        onSelect={() => undefined}
        onPreset={() => undefined}
        meId="5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11"
        can={{ create: true, update: true, delete: true }}
      />
    </ToastProvider>,
    {
      session: makeSession(),
      seed: [
        [['contacts', 'views'], []],
        ...(scoring === 'unknown'
          ? []
          : [[['lead-scoring', 'status'], { enabled: scoring === 'on' }] as const]),
      ],
    },
  );

const OTHER_CHIPS = ['My contacts', 'Unassigned', 'New this week', 'Needs follow-up'];

describe('the quick chips of the Contacts list', () => {
  it('offer Hot leads while lead scoring is on', () => {
    const out = draw('on');
    for (const chip of [...OTHER_CHIPS, 'Hot leads']) expect(out, chip).toContain(chip);
  });

  it('leave Hot leads out while lead scoring is off, and keep the other four', () => {
    const out = draw('off');
    expect(out).not.toContain('Hot leads');
    for (const chip of OTHER_CHIPS) expect(out, chip).toContain(chip);
  });

  it('leave Hot leads out until the switch is known', () => {
    const out = draw('unknown');
    expect(out).not.toContain('Hot leads');
    for (const chip of OTHER_CHIPS) expect(out, chip).toContain(chip);
  });
});
