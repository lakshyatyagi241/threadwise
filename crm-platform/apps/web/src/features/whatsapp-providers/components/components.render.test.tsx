import { describe, expect, it, vi } from 'vitest';
import {
  PLATFORM_PERMISSION_KEYS,
  type ChannelProviderInfo,
  type ListAssignmentsResponse,
} from '@crm/contracts';
import { rbacKeys } from '@/features/roles-permissions/lib/api';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { PROVIDER_INFO_KEY, wapKeys } from '../api';
import { newRow } from '../lib/header-templates';
import { summarizePlan } from '../lib/switch-plan';
import { ID, provider, switchResponse } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/admin/whatsapp-providers',
}));

import { AssignmentsPage } from './assignments-page';
import { HeaderTemplatesEditor, RequestPreview } from './header-templates-editor';
import { ProviderDetailPage } from './provider-detail-page';
import { ProviderForm } from './provider-form';
import { ProviderNewPage } from './provider-new-page';
import { ProvidersPage } from './providers-page';
import {
  NumbersTable,
  PlanSummary,
  RequirementAdvice,
  ResultView,
  SwitchPage,
} from './switch-page';
import { TestPanel } from './test-panel';
import { SecretField, SecretState } from './ui';
import { WorkspaceProviderNote } from './workspace-provider-note';

/**
 * These render each screen to static HTML with the real English and Arabic messages. They prove the text is complete (a missing or
 * broken message throws), that permissions decide what is offered, and that no secret ever reaches the page. There is no browser
 * here: nothing below says how the screens look or behave when clicked.
 */

const KEY = (name: 'view' | 'manage' | 'switch') => `platform.whatsapp_providers.${name}`;
const me = (held: Array<'view' | 'manage' | 'switch'>) =>
  [
    rbacKeys.me,
    {
      permissions: Object.fromEntries(
        PLATFORM_PERMISSION_KEYS.map((k) => [k, held.some((h) => KEY(h) === k)]),
      ),
      roles: ['Admin'],
      isSuperAdmin: false,
    },
  ] as const;
const ALL = me(['view', 'manage', 'switch']);

const providers = [
  provider({
    id: ID(1),
    key: 'pinnacle',
    label: 'Pinnacle BSP',
    status: 'active',
    isDefault: true,
    numberCount: 3,
    workspaceCount: 1,
  }),
  provider({
    id: ID(2),
    key: 'meta',
    label: 'Meta Cloud',
    builtin: 'meta',
    status: 'active',
    headerTemplates: {},
    authScheme: 'bearer',
    credentialMode: 'channel_token',
    billingMode: 'customer_direct',
    signatureScheme: 'meta_app_secret_sha256',
    signatureHeaderName: null,
  }),
  provider({ id: ID(3), key: 'oldbsp', label: 'Old BSP', status: 'archived' }),
];
const LIST = [wapKeys.list, { data: providers }] as const;

const LOCALES = ['en', 'ar'] as const;

describe('providers list', () => {
  for (const locale of LOCALES) {
    it(`renders every provider with its status, badges and usage in ${locale}`, () => {
      const html = renderWithMessages(<ProvidersPage />, { locale, seed: [ALL, LIST] });
      expect(html).toContain('Pinnacle BSP');
      expect(html).toContain('Meta Cloud');
      expect(html).toContain('data-testid="provider-pinnacle"');
      expect(html).toContain('/admin/whatsapp-providers/new');
      expect(html).toContain('/admin/settings/whatsapp');
    });
  }

  it('offers add, manage and switch only to an operator who holds those permissions', () => {
    const viewOnly = renderWithMessages(<ProvidersPage />, { seed: [me(['view']), LIST] });
    expect(viewOnly).not.toContain('/admin/whatsapp-providers/new');
    expect(viewOnly).not.toContain('/admin/whatsapp-providers/switch');
    expect(viewOnly).not.toContain('aria-haspopup="menu"');
    const manage = renderWithMessages(<ProvidersPage />, { seed: [me(['view', 'manage']), LIST] });
    expect(manage).toContain('/admin/whatsapp-providers/new');
    expect(manage).toContain('aria-haspopup="menu"');
    const withSwitch = renderWithMessages(<ProvidersPage />, {
      seed: [me(['view', 'switch']), LIST],
    });
    expect(withSwitch).toContain('/admin/whatsapp-providers/switch');
  });

  it('shows the no-access page, naming the key, to an operator without view', () => {
    const html = renderWithMessages(<ProvidersPage />, { seed: [me([]), LIST] });
    expect(html).toContain(KEY('view'));
    expect(html).not.toContain('Pinnacle BSP');
  });

  it('shows the empty state with an add button', () => {
    const html = renderWithMessages(<ProvidersPage />, {
      seed: [ALL, [wapKeys.list, { data: [] }]],
    });
    expect(html).toContain('No providers yet');
    expect(html).toContain('Add provider');
  });
});

describe('provider detail', () => {
  const p = providers[0]!;
  for (const locale of LOCALES) {
    it(`renders the overview, the test panel and the edit form in ${locale}`, () => {
      const html = renderWithMessages(<ProviderDetailPage id={p.id} />, {
        locale,
        seed: [ALL, [wapKeys.one(p.id), p]],
      });
      expect(html).toContain('Pinnacle BSP');
      expect(html).toContain('/v2/public/webhooks/whatsapp');
      // every section of the form is on the page
      expect(html).toContain('x-api-key');
      expect(html).toContain('x-bsp-secret');
    });
  }

  it('shows secrets only as set, with the last four characters', () => {
    const html = renderWithMessages(<ProviderDetailPage id={p.id} />, {
      seed: [ALL, [wapKeys.one(p.id), p]],
    });
    expect(html).toContain('Set, ends in 9f2a');
    expect(html).toContain('Set, ends in c0de');
    expect(html).toContain('Not set');
    // the password inputs carry no value
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it('a read-only operator sees the provider but no lifecycle buttons, no edit form and no test button', () => {
    const html = renderWithMessages(<ProviderDetailPage id={p.id} />, {
      seed: [me(['view']), [wapKeys.one(p.id), p]],
    });
    expect(html).toContain('Pinnacle BSP');
    expect(html).toContain('Changing it needs the manage permission');
    expect(html).not.toContain('Make default');
    expect(html).not.toContain('Run test');
    expect(html).not.toContain('Save changes');
  });

  it('explains why a default provider cannot be disabled or archived', () => {
    const html = renderWithMessages(<ProviderDetailPage id={p.id} />, {
      seed: [ALL, [wapKeys.one(p.id), p]],
    });
    expect(html).toContain('it is the default');
    expect(html).toContain('Clear default');
  });

  it('tells a built-in provider apart: no secrets block, a link to the console settings', () => {
    const builtin = providers[1]!;
    const html = renderWithMessages(<ProviderDetailPage id={builtin.id} />, {
      seed: [ALL, [wapKeys.one(builtin.id), builtin]],
    });
    expect(html).toContain('Built-in');
    expect(html).toContain('/admin/settings/whatsapp');
    expect(html).not.toContain('Stored secrets');
  });

  it('lists what a provider still lacks before it can work', () => {
    const lacking = provider({
      id: ID(9),
      signatureScheme: 'meta_app_secret_sha256',
      credentials: {
        providerToken: { set: false, last4: null },
        appSecret: { set: false, last4: null },
        webhookSecret: { set: false, last4: null },
        verifyToken: { set: false, last4: null },
      },
    });
    const html = renderWithMessages(<ProviderDetailPage id={lacking.id} />, {
      seed: [ALL, [wapKeys.one(lacking.id), lacking]],
    });
    expect(html).toContain('Still missing before this provider works');
    expect(html).toContain('provider token is not stored');
    expect(html).toContain('app secret is not stored');
  });
});

describe('add and edit forms', () => {
  for (const locale of LOCALES) {
    it(`the wizard starts on its first step in ${locale}`, () => {
      const html = renderWithMessages(<ProviderNewPage />, { locale, seed: [ALL] });
      expect(html).toContain('aria-current="step"');
      expect(html).toContain('placeholder="pinnacle"');
    });
  }

  it('the wizard asks for the manage permission', () => {
    const html = renderWithMessages(<ProviderNewPage />, { seed: [me(['view'])] });
    expect(html).toContain(KEY('manage'));
    expect(html).not.toContain('aria-current="step"');
  });

  for (const locale of LOCALES) {
    it(`the edit form shows every section, with the custom header editor and its preview in ${locale}`, () => {
      const html = renderWithMessages(<ProviderForm mode="edit" provider={providers[0]!} />, {
        locale,
      });
      expect(html).toContain('data-testid="request-preview"');
      expect(html).toContain('GET https://api.pinnacle.example-bsp.com/wa/v25.0/me');
      expect(html).toContain('x-api-key: &lt;provider-token&gt;');
      expect(html).toContain('type="radio"');
    });
  }

  it('a built-in provider only offers name, notes and billing mode', () => {
    const html = renderWithMessages(<ProviderForm mode="edit" provider={providers[1]!} />);
    expect(html).toContain('built-in provider');
    expect(html).not.toContain('data-testid="request-preview"');
    expect(html).toContain('/admin/settings/whatsapp');
  });

  it('locks the credential mode while numbers are connected through the provider', () => {
    const html = renderWithMessages(<ProviderForm mode="edit" provider={providers[0]!} />);
    expect(html).toContain('3 numbers are');
    expect(html).toContain('disabled=""');
  });

  it('a secret field never renders a stored value', () => {
    const html = renderWithMessages(
      <SecretField
        label="Provider token"
        state={{ set: true, last4: '1234' }}
        edit={{ value: '', clear: false }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('Set, ends in 1234');
    expect(html).toContain('Remove the stored value');
    expect(html).toContain('type="password"');
    const unset = renderWithMessages(
      <SecretField
        label="x"
        state={null}
        edit={{ value: '', clear: false }}
        onChange={() => undefined}
      />,
    );
    expect(unset).toContain('Not set');
    expect(renderWithMessages(<SecretState state={{ set: false, last4: null }} />)).toContain(
      'Not set',
    );
  });
});

describe('header editor and preview', () => {
  const rows = [
    newRow('x-api-key', '{{providerToken}}'),
    newRow('host', 'x'),
    newRow('x-waba', '{{nope}}'),
  ];
  for (const locale of LOCALES) {
    it(`shows each row's own problems in ${locale}`, () => {
      const html = renderWithMessages(
        <HeaderTemplatesEditor
          rows={rows}
          onChange={() => undefined}
          problems={[
            { code: 'nameDenied', rowId: rows[1]!.id, values: { name: 'host' } },
            {
              code: 'placeholderUnknown',
              rowId: rows[2]!.id,
              values: { name: 'x-waba', names: 'nope' },
            },
            { code: 'credentialNotCarried', values: { placeholder: '{{providerToken}}' } },
          ]}
          credentialMode="platform_token"
        />,
        { locale },
      );
      expect(html).toContain('{{providerToken}}');
      expect(html).toContain('role="alert"');
    });
  }

  it('previews the call with stand-in values only', () => {
    const html = renderWithMessages(
      <RequestPreview
        baseUrl="https://api.example-bsp.com/wa"
        apiVersion="v25.0"
        authScheme="custom_headers"
        rows={[newRow('x-api-key', '{{providerToken}}'), newRow('x-ph', '{{phoneNumberId}}')]}
        credentialMode="platform_token"
      />,
    );
    expect(html).toContain('GET https://api.example-bsp.com/wa/v25.0/me');
    expect(html).toContain('x-api-key: &lt;provider-token&gt;');
    expect(html).toContain('x-ph: PHONE_NUMBER_ID');
    const pending = renderWithMessages(
      <RequestPreview
        baseUrl="nope"
        apiVersion="v25.0"
        authScheme="bearer"
        rows={[]}
        credentialMode="channel_token"
      />,
    );
    expect(pending).toContain('(enter a valid address)');
    expect(pending).toContain('authorization: Bearer &lt;number-token&gt;');
  });
});

describe('test connection panel', () => {
  const tested = provider({
    lastTest: {
      ok: false,
      testedAt: '2026-10-02T10:00:00.000Z',
      latencyMs: 182,
      httpStatus: 401,
      errorCode: 'HTTP_401',
      message: 'Invalid token [redacted]',
    },
  });
  for (const locale of LOCALES) {
    it(`shows the last result and what to fix in ${locale}`, () => {
      const html = renderWithMessages(<TestPanel provider={tested} canTest />, { locale });
      expect(html).toContain('401');
      expect(html).toContain('Invalid token [redacted]');
      expect(html).toContain('data-testid="test-result"');
    });
  }

  it('offers a number token field only where it can matter, and never a value', () => {
    const own = renderWithMessages(
      <TestPanel provider={provider({ credentialMode: 'channel_token' })} canTest />,
    );
    expect(own).toContain('Test number token');
    expect(own).toContain('type="password"');
    const platform = renderWithMessages(<TestPanel provider={provider()} canTest />);
    expect(platform).not.toContain('Test number token');
  });

  it('says a test has not been run, and hides the form from a read-only operator', () => {
    const html = renderWithMessages(<TestPanel provider={provider()} canTest={false} />);
    expect(html).toContain('has not been tested yet');
    expect(html).not.toContain('Run test');
  });
});

describe('workspace assignments', () => {
  const page: ListAssignmentsResponse = {
    data: [
      {
        workspaceId: ID(50),
        name: 'Acme Retail',
        slug: 'acme',
        override: { id: ID(1), key: 'pinnacle', label: 'Pinnacle BSP' },
        effective: {
          source: 'override',
          providerKey: 'pinnacle',
          provider: { id: ID(1), key: 'pinnacle', label: 'Pinnacle BSP' },
        },
        numberCount: 4,
        numbersOnOtherProvider: 2,
        assignedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        workspaceId: ID(51),
        name: 'Beta Co',
        slug: 'beta',
        override: null,
        effective: { source: 'platform_setting', providerKey: 'meta', provider: null },
        numberCount: 0,
        numbersOnOtherProvider: 0,
        assignedAt: null,
      },
    ],
    page: { nextCursor: null, hasMore: false, limit: 50 },
    registryDefault: { id: ID(1), key: 'pinnacle', label: 'Pinnacle BSP' },
  };
  const seed = [
    ALL,
    [wapKeys.assignments('', false), { pages: [page], pageParams: [undefined] }],
  ] as const;

  for (const locale of LOCALES) {
    it(`lists workspaces with override, effective provider and numbers elsewhere in ${locale}`, () => {
      const html = renderWithMessages(<AssignmentsPage />, { locale, seed: [...seed] });
      expect(html).toContain('data-testid="workspace-acme"');
      expect(html).toContain('data-testid="workspace-beta"');
    });
  }

  it('links to the switch only for a workspace that has numbers, with the workspace in the link', () => {
    const html = renderWithMessages(<AssignmentsPage />, { seed: [...seed] });
    expect(html).toContain(`/admin/whatsapp-providers/switch?workspace=${ID(50)}`);
    expect(html).not.toContain(`workspace=${ID(51)}`);
    expect(html).toContain('data-testid="clear-override-acme"');
    expect(html).not.toContain('data-testid="clear-override-beta"');
    expect(html).toContain('data-testid="set-override-beta"');
  });

  it('shows no change buttons to an operator without manage', () => {
    const html = renderWithMessages(<AssignmentsPage />, {
      seed: [
        me(['view']),
        [wapKeys.assignments('', false), { pages: [page], pageParams: [undefined] }],
      ],
    });
    expect(html).not.toContain('data-testid="clear-override-acme"');
    expect(html).not.toContain('data-testid="set-override-beta"');
    expect(html).not.toContain('/switch?workspace');
  });
});

describe('switch flow', () => {
  const picker = {
    data: [
      {
        workspaceId: ID(50),
        name: 'Acme Retail',
        slug: 'acme',
        override: null,
        effective: { source: 'default', providerKey: 'pinnacle', provider: null },
        numberCount: 4,
        numbersOnOtherProvider: 2,
        assignedAt: null,
      },
    ],
    page: { nextCursor: null, hasMore: false, limit: 50 },
    registryDefault: null,
  };

  for (const locale of LOCALES) {
    it(`starts with the workspace picker, the target and the dry run in ${locale}`, () => {
      const html = renderWithMessages(<SwitchPage />, {
        locale,
        seed: [ALL, LIST, [wapKeys.workspacePicker(''), picker]],
      });
      expect(html).toContain('Acme Retail');
      expect(html).toContain('disabled=""');
    });
  }

  it('asks for the switch permission as well as view', () => {
    const html = renderWithMessages(<SwitchPage />, { seed: [me(['view', 'manage']), LIST] });
    expect(html).toContain(KEY('switch'));
  });

  it('starts on a workspace and a target given in the link', () => {
    const html = renderWithMessages(
      <SwitchPage workspaceId={ID(50)} workspaceName="Acme Retail" targetId={ID(1)} />,
      { seed: [ALL, LIST] },
    );
    expect(html).toContain('Acme Retail');
    expect(html).toContain(ID(50));
    expect(html).toContain('Change workspace');
  });

  it('ignores a workspace or target in the link that is not an id', () => {
    const html = renderWithMessages(<SwitchPage workspaceId="x" targetId="y" />, {
      seed: [ALL, LIST, [wapKeys.workspacePicker(''), picker]],
    });
    expect(html).not.toContain('Change workspace');
  });

  const plan = switchResponse();
  for (const locale of LOCALES) {
    it(`renders a dry run: numbers, states, requirements and what needs a person in ${locale}`, () => {
      const html = renderWithMessages(
        <div>
          <PlanSummary summary={summarizePlan(plan)} target={plan.to} workspaceName="Acme Retail" />
          <NumbersTable
            numbers={plan.numbers}
            mode="plan"
            ticked={new Set([plan.numbers[0]!.numberId])}
            onToggle={() => undefined}
          />
          <RequirementAdvice present={['number_token_needed', 'reconnect_needed']} />
        </div>,
        { locale },
      );
      expect(html).toContain('Number 1');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('checked=""');
    });
  }

  it('only a ready number can be ticked; blocked ones are disabled', () => {
    const html = renderWithMessages(
      <NumbersTable
        numbers={plan.numbers}
        mode="plan"
        ticked={new Set()}
        onToggle={() => undefined}
      />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  const result = switchResponse({
    dryRun: false,
    overrideSet: true,
    numbers: [
      {
        ...plan.numbers[0]!,
        state: 'switched',
        inboundWired: false,
        message: 'App-level callback applies',
      },
      { ...plan.numbers[1]!, state: 'repointed' },
      { ...plan.numbers[2]!, state: 'failed', message: 'Provider refused the subscription' },
    ],
  });
  for (const locale of LOCALES) {
    it(`renders the applied result with per-number outcomes and the rollback in ${locale}`, () => {
      const html = renderWithMessages(
        <ResultView
          result={result}
          workspaceName="Acme Retail"
          onStartOver={() => undefined}
          onRollback={() => undefined}
        />,
        { locale },
      );
      expect(html).toContain('Provider refused the subscription');
      expect(html).toContain(locale === 'en' ? 'Prepare a switch back to Meta' : 'إلى Meta');
    });
  }

  it('offers no rollback when nothing moved', () => {
    const none = switchResponse({
      dryRun: false,
      numbers: [{ ...plan.numbers[0]!, state: 'failed' }],
    });
    const html = renderWithMessages(
      <ResultView
        result={none}
        workspaceName={null}
        onStartOver={() => undefined}
        onRollback={() => undefined}
      />,
    );
    expect(html).not.toContain('Prepare a switch back');
    expect(html).toContain('No number was moved');
  });
});

describe('workspace provider note', () => {
  const info: ChannelProviderInfo = {
    newNumbers: {
      providerKey: 'pinnacle',
      providerLabel: 'Pinnacle BSP',
      credentialMode: 'platform_token',
      capabilities: { mediaUpload: false },
      onboardingMethods: ['manual'],
    },
    numbers: [
      {
        id: ID(70),
        label: 'Support line',
        phoneNumber: '+15550001',
        providerKey: 'meta',
        providerLabel: 'Meta',
        credentialMode: 'channel_token',
        capabilities: { mediaUpload: true },
      },
    ],
  };
  for (const locale of LOCALES) {
    it(`names the provider, the credential and media support in ${locale}`, () => {
      const html = renderWithMessages(<WorkspaceProviderNote />, {
        locale,
        seed: [[PROVIDER_INFO_KEY, info]],
      });
      expect(html).toContain('data-testid="provider-note"');
      expect(html).toContain('Pinnacle BSP');
    });
  }

  it('says so when no provider can take a new number, and stays out of the way while loading', () => {
    const none = renderWithMessages(<WorkspaceProviderNote />, {
      seed: [[PROVIDER_INFO_KEY, { newNumbers: null, numbers: [] }]],
    });
    expect(none).toContain('No provider is available');
    expect(renderWithMessages(<WorkspaceProviderNote />)).not.toContain(
      'data-testid="provider-note"',
    );
  });

  it('carries no address, header or secret: the page has nothing but the labels it was given', () => {
    const html = renderWithMessages(<WorkspaceProviderNote />, {
      seed: [[PROVIDER_INFO_KEY, info]],
    });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('Support line is on Meta');
  });
});
