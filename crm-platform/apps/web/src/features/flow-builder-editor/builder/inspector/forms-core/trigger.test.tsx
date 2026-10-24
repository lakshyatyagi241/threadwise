import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { FlbBuilderContext } from '@crm/contracts';
import { renderIntl } from '../../../test-utils/intl';
import { EMPTY_CONTEXT } from '../../../api/hooks';
import type { FormEnv, FormProps } from '../types';
import { TriggerForm } from './trigger';

function renderTrigger(data: Record<string, unknown>, ctx: Partial<FlbBuilderContext> = {}) {
  const env = {
    ctx: { ...EMPTY_CONTEXT, ...ctx },
    loading: false,
    mode: 'chat',
    openedAs: 'chat',
    channels: ['chat', 'instagram'],
    refresh: () => undefined,
    toast: () => undefined,
    uploadMedia: async () => ({ url: '', filename: '' }),
    nodes: [],
    flowId: null,
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

describe('Comment to DM trigger with no keyword rules (row 229)', () => {
  it('shows the hint as plain text with no link to /auto-reply, which is not built yet', () => {
    const html = renderTrigger({ kind: 'comment_to_dm', channel: 'instagram', keywordRuleIds: [] });

    expect(html).toContain('No Comment → DM keyword rules yet, so there is nothing to pick here.');
    expect(html).not.toContain('/auto-reply');
  });
});
