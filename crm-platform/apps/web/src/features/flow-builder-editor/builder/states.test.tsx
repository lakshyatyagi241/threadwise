import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, FLOW_API_LIBRARY_NODE_TYPE } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { EMPTY_CONTEXT } from '../api/hooks';
import { renderIntl, translator } from '../test-utils/intl';
import { aiGenerateError } from './ai-generate-error';
import { GoogleFilePicker } from './inspector/forms-channels/google';
import { NODE_FORMS } from './inspector/registry';
import type { FormProps } from './inspector/types';
import { Palette } from './palette';

const state = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  files: {} as Record<string, unknown>,
}));
vi.mock('@/features/api-library', () => ({ useApiLibraryOptions: () => state.options }));
vi.mock('../api/hooks', async (orig) => ({
  ...(await orig<typeof import('../api/hooks')>()),
  useGoogleFiles: () => state.files,
}));

const props = (data: Record<string, unknown>): FormProps => ({
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
});
const withQuery = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);
const apiForm = () =>
  renderIntl(
    withQuery(
      NODE_FORMS[FLOW_API_LIBRARY_NODE_TYPE]!(props({ apiId: '', inputs: [] })) as ReactNode,
    ),
  );
const palette = (query: string) =>
  renderIntl(
    <Palette mode="chat" query={query} onSearch={() => undefined} onAddCenter={() => undefined} />,
  );

beforeEach(() => {
  state.options = {
    isPending: false,
    isError: false,
    data: { data: [] },
    refetch: () => undefined,
  };
  state.files = { isPending: false, isError: false, data: { data: [] } };
});

describe('flow builder states', () => {
  it('shows an error state with a refresh when the saved APIs fail to load', () => {
    state.options = { ...state.options, isError: true, data: undefined };
    const out = apiForm();
    expect(out).toContain('Your saved APIs could not be loaded.');
    expect(out).toContain('Refresh list');
  });

  it('shows no load error when the saved APIs load, only the empty list', () => {
    const out = apiForm();
    expect(out).not.toContain('could not be loaded');
    expect(out).toContain('No saved APIs yet');
  });

  it('shows an error state with a link to the Google account when the files fail to load', () => {
    state.files = { isPending: false, isError: true, error: new Error('boom') };
    const out = renderIntl(
      withQuery(<GoogleFilePicker p={props({})} kind="sheets" dataKey="sheetId" />),
    );
    expect(out).toContain('so your sheets can');
    expect(out).toContain('Connect Google to pick one.');
    expect(out).toContain('/google-account');
    expect(out).not.toContain('boom');
  });

  it('shows the missing permission message when the files fail to load for a missing scope', () => {
    state.files = {
      isPending: false,
      isError: true,
      error: new ApiError(403, ERROR_CODES.GOOGLE_SCOPE_MISSING, 'scope'),
    };
    const out = renderIntl(
      withQuery(<GoogleFilePicker p={props({})} kind="docs" dataKey="docId" />),
    );
    expect(out).toContain('Drive file list permission was not given');
  });

  // Saving a flow, publishing and generating fire from a click, which string rendering cannot press;
  // this covers the text the Generate-with-AI modal shows when the request fails.
  it('words the field error when create fails with a validation code', () => {
    const t = translator('flb.builder.shell.aiError');
    const e = new ApiError(422, 'VALIDATION_FAILED', 'bad', undefined, [
      { path: 'prompt', message: 'String must contain at least 1 character(s)' },
    ]);
    expect(aiGenerateError(e, t as never)).toBe('The prompt field is required.');
  });

  it('shows the generation status, or the network message, when the update fails with no detail', () => {
    const t = translator('flb.builder.shell.aiError') as never;
    expect(aiGenerateError(new ApiError(504, 'INTERNAL', 'x'), t)).toBe('Generation failed (504)');
    expect(aiGenerateError('offline', t)).toBe('Network error');
  });

  it('lists the nodes, not the no results message, for an empty search', () => {
    const out = palette('');
    expect(out).not.toContain('No nodes match.');
    expect(out).toContain('data-palette-type=');
  });

  it('shows no results when the filters match nothing, with no node cards', () => {
    const out = palette('zzqqxx');
    expect(out).toContain('No nodes match.');
    expect(out).not.toContain('data-palette-type=');
  });
});
