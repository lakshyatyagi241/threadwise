import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOW_API_LIBRARY_NODE_TYPE,
  apiLibraryNodeDataSchema,
  flbDefaultNodeData,
  flbValidateGraph,
  type ApiLibraryOption,
} from '@crm/contracts';
import { renderIntl } from '../../../test-utils/intl';
import { EMPTY_CONTEXT } from '../../../api/hooks';
import { NODE_FORMS } from '../registry';
import type { FormProps } from '../types';
import { inputsAfterEdit, readInputs } from './api-library';

const state = vi.hoisted(() => ({
  options: {
    isPending: false,
    isError: false,
    data: { data: [] as unknown[] },
    refetch: () => undefined,
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/features/api-library', () => ({ useApiLibraryOptions: () => state.options }));

const ID = '00000000-0000-4000-8000-000000000001';
const api = (over: Partial<ApiLibraryOption> = {}): ApiLibraryOption => ({
  id: ID,
  name: 'Orders',
  method: 'POST',
  variables: [
    { name: 'order_id', source: 'contact', defaultValue: '42' },
    { name: 'phone', source: 'contact', defaultValue: '000' },
  ],
  responseVariables: ['data.status'],
  ...over,
});

function render(data: Record<string, unknown>) {
  const Form = NODE_FORMS[FLOW_API_LIBRARY_NODE_TYPE]!;
  const props: FormProps = {
    node: { id: 'n1', type: FLOW_API_LIBRARY_NODE_TYPE, x: 0, y: 0, data } as never,
    data,
    set: () => undefined,
    setMany: () => undefined,
    addOption: () => undefined,
    removeOption: () => undefined,
    env: {
      ctx: EMPTY_CONTEXT,
      loading: false,
      mode: 'chat',
      openedAs: 'chat',
      channels: ['chat'],
      refresh: () => undefined,
      toast: () => undefined,
      uploadMedia: async () => ({ url: '', filename: '' }),
      nodes: [],
      flowId: null,
    },
  };
  return renderIntl(
    <QueryClientProvider client={new QueryClient()}>
      {Form(props) as ReactNode}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.options = {
    isPending: false,
    isError: false,
    data: { data: [api()] },
    refetch: () => undefined,
  };
});

describe('API (from library) node form', () => {
  it('is registered for the catalogue type, with the data the contract expects', () => {
    expect(NODE_FORMS.api_library).toBeDefined();
    expect(apiLibraryNodeDataSchema.safeParse(flbDefaultNodeData('api_library')).success).toBe(
      true,
    );
  });

  it('lists the saved APIs with their method', () => {
    const out = render({ apiId: '', apiName: '', inputs: [], save: 'api_response' });
    expect(out).toContain('Orders (POST)');
    expect(out).toContain('— pick an API —');
    expect(out).not.toContain('Variables');
  });

  it('shows the picked API variables as inputs with the defaults as hints', () => {
    const out = render({
      apiId: ID,
      apiName: 'Orders',
      inputs: [{ name: 'order_id', value: '{{id}}' }],
      save: 'resp',
    });
    expect(out).toContain('order_id');
    expect(out).toContain('phone');
    expect(out).toContain('placeholder="Default: 42"');
    expect(out).toContain('value="{{id}}"');
    expect(out).toContain('{{resp.status}}');
    expect(out).toContain('{{Orders.data.status}}');
  });

  it('keeps a deleted API visible as not found, and says so while loading', () => {
    state.options = {
      isPending: false,
      isError: false,
      data: { data: [] },
      refetch: () => undefined,
    };
    expect(render({ apiId: ID, apiName: 'Gone', inputs: [], save: '' })).toContain(
      'Gone (not found)',
    );
    state.options = {
      isPending: true,
      isError: false,
      data: { data: [] },
      refetch: () => undefined,
    };
    const out = render({ apiId: ID, apiName: 'Gone', inputs: [], save: '' });
    expect(out).toContain('Loading APIs');
    expect(out).not.toContain('not found');
  });

  it('says when the list could not be loaded and when there are no APIs', () => {
    state.options = {
      isPending: false,
      isError: true,
      data: { data: [] },
      refetch: () => undefined,
    };
    expect(render({ apiId: '', inputs: [] })).toContain('could not be loaded');
    state.options = {
      isPending: false,
      isError: false,
      data: { data: [] },
      refetch: () => undefined,
    };
    expect(render({ apiId: '', inputs: [] })).toContain('No saved APIs yet');
  });
});

describe('node inputs', () => {
  const a = api();

  it('stores only the values the author typed, in the API order', () => {
    expect(inputsAfterEdit(a, [], 'phone', '{{contact_phone}}')).toEqual([
      { name: 'phone', value: '{{contact_phone}}' },
    ]);
    expect(inputsAfterEdit(a, [{ name: 'phone', value: 'x' }], 'order_id', '7')).toEqual([
      { name: 'order_id', value: '7' },
      { name: 'phone', value: 'x' },
    ]);
  });

  it('drops an input that was emptied', () => {
    expect(inputsAfterEdit(a, [{ name: 'order_id', value: '7' }], 'order_id', '  ')).toEqual([]);
  });

  it('reads whatever the node holds without throwing', () => {
    expect(readInputs(undefined)).toEqual([]);
    expect(readInputs([null, { name: '' }, { name: 'a', value: 1 }])).toEqual([
      { name: 'a', value: '1' },
    ]);
  });
});

describe('graph validation', () => {
  it('blocks a node with no API picked', () => {
    const node = { id: 'n1', type: 'api_library', x: 0, y: 0, data: { apiId: '' } };
    const r = flbValidateGraph([node] as never, [], { senderAvailable: true } as never);
    expect(JSON.stringify(r)).toContain('has no API selected');
  });
});
