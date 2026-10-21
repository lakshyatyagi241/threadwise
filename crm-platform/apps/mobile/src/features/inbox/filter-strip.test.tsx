import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { FilterStrip } from './filter-strip';
import { DEFAULT_FILTERS, type InboxFilters } from './filters';

const noop = () => undefined;
const show = (filters: InboxFilters, agentNames: readonly string[] = []) =>
  renderApp(
    <FilterStrip
      filters={filters}
      channelName={null}
      labelNames={[]}
      agentNames={agentNames}
      onClearStatus={noop}
      onClearSearch={noop}
      onClearChannel={noop}
      onClearLabels={noop}
      onClearAgents={noop}
      onClearSort={noop}
      onClearArchived={noop}
      onClearAll={noop}
    />,
  );

beforeAll(async () => {
  await initI18n('en');
});

describe('FilterStrip: agents and sort', () => {
  it('names the chosen agents', async () => {
    await show({ ...DEFAULT_FILTERS, agentIds: ['a1', 'a2'] }, ['Asha Verma', 'Kabir Rao']);
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Agent: Asha Verma, Kabir Rao' }),
    ).toBeTruthy();
  });
  it('says how many more are on when only some names are known', async () => {
    await show({ ...DEFAULT_FILTERS, agentIds: ['a1', 'a2', 'a3'] }, ['Asha Verma']);
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Agent: Asha Verma +2' }),
    ).toBeTruthy();
  });
  it('shows a count while no name is known yet', async () => {
    await show({ ...DEFAULT_FILTERS, agentIds: ['a1', 'a2'] });
    expect(await screen.findByRole('button', { name: 'Remove filter: Agent: 2' })).toBeTruthy();
  });
  it('shows the oldest-first order as a chip, and nothing for the default order', async () => {
    const view = await show({ ...DEFAULT_FILTERS, sort: 'old' });
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Sort: Oldest first' }),
    ).toBeTruthy();
    await view.rerender(
      <FilterStrip
        filters={{ ...DEFAULT_FILTERS, status: 'resolved' }}
        channelName={null}
        labelNames={[]}
        agentNames={[]}
        onClearStatus={noop}
        onClearSearch={noop}
        onClearChannel={noop}
        onClearLabels={noop}
        onClearAgents={noop}
        onClearSort={noop}
        onClearArchived={noop}
        onClearAll={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /Sort:/ })).toBeNull();
  });
});
