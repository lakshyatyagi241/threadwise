import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../../test-utils/intl';
import { EMPTY_CONTEXT } from '../../../api/hooks';
import type { FormEnv, FormProps } from '../types';
import { sampleHookCurl } from './outside-triggers';
import { TriggerForm } from './trigger';

const state = vi.hoisted(() => ({
  hook: {} as Record<string, unknown>,
  google: {} as Record<string, unknown>,
}));
vi.mock('../../../api/hooks', async (orig) => ({
  ...(await orig<typeof import('../../../api/hooks')>()),
  useFlowWebhook: () => state.hook,
  useGoogleSummary: () => state.google,
  useGoogleFiles: () => ({ isPending: false, isError: false, data: { data: [] } }),
}));

const ADDRESS =
  'https://api.example.test/v2/public/flow-hooks/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b/tok123';

function render(data: Record<string, unknown>, flowId: string | null = 'flow-1') {
  const env = {
    ctx: EMPTY_CONTEXT,
    loading: false,
    mode: 'chat',
    openedAs: 'chat',
    channels: ['chat'],
    refresh: () => undefined,
    toast: () => undefined,
    uploadMedia: async () => ({ url: '', filename: '' }),
    nodes: [],
    flowId,
  } as unknown as FormEnv;
  const props = {
    node: { id: 'n1', type: 'trigger', x: 0, y: 0, data },
    data,
    set: () => undefined,
    setMany: () => undefined,
    addOption: () => undefined,
    removeOption: () => undefined,
    env,
  } as unknown as FormProps;
  return renderIntl(
    <QueryClientProvider client={new QueryClient()}>
      <TriggerForm {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.hook = {
    isPending: false,
    isError: false,
    data: { path: '/v2/x', url: ADDRESS, live: true },
  };
  state.google = { data: undefined };
});

describe('the Trigger node offers the two outside triggers', () => {
  it('lists Webhook and Google Sheet in the start dropdown of a chat flow', () => {
    const html = render({ kind: 'keyword' });
    expect(html).toContain('value="webhook"');
    expect(html).toContain('value="google_sheet"');
  });
});

describe('the Webhook trigger form', () => {
  it('shows the address, a copy button, a sample call and how the body maps', () => {
    const html = render({ kind: 'webhook' });
    expect(html).toContain(ADDRESS);
    expect(html).toContain('Copy');
    expect(html).toContain(`curl -X POST &#x27;${ADDRESS}&#x27;`);
    expect(html).toContain('Idempotency-Key');
    expect(html).toContain('{{order_id}}');
    expect(html).not.toContain('only starts the flow once it is published');
  });

  it('says to publish first when the flow is not live, and to save first when it has no id yet', () => {
    state.hook = {
      isPending: false,
      isError: false,
      data: { path: '/v2/x', url: ADDRESS, live: false },
    };
    expect(render({ kind: 'webhook' })).toContain('only starts the flow once it is published');
    expect(render({ kind: 'webhook' }, null)).toContain('Save the flow first');
  });

  it('falls back to the path when the server does not know its public address, and tells when the address cannot be loaded', () => {
    state.hook = {
      isPending: false,
      isError: false,
      data: { path: '/v2/public/flow-hooks/a/b', url: null, live: true },
    };
    expect(render({ kind: 'webhook' })).toContain('/v2/public/flow-hooks/a/b');
    state.hook = { isPending: false, isError: true, data: undefined };
    expect(render({ kind: 'webhook' })).toContain('could not be loaded');
  });

  it('builds the sample call from the address', () => {
    expect(sampleHookCurl('https://h/x')).toMatch(/^curl -X POST 'https:\/\/h\/x' \\\n/);
  });
});

describe('the Google Sheet trigger form', () => {
  it('asks for the sheet, the columns and the interval, and warns when Google is not connected', () => {
    state.google = { data: { status: 'disconnected', granted: [] } };
    const html = render({ kind: 'google_sheet', intervalMinutes: 2 });
    expect(html).toContain('Spreadsheet');
    expect(html).toContain('Phone column');
    expect(html).toContain('2 minutes');
    expect(html).toContain('/google-account');
    expect(html).toContain('rows already in the sheet never do');
  });

  it('shows no warning when the account is connected with the Sheets permission', () => {
    state.google = { data: { status: 'connected', granted: ['sheets'] } };
    const html = render({ kind: 'google_sheet' });
    expect(html).not.toContain('/google-account"');
  });
});
