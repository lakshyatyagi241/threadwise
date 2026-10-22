import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { FilterStrip } from './filter-strip';
import { DEFAULT_FILTERS, type InboxFilters } from './filters';

const noop = () => undefined;
const show = (
  filters: InboxFilters,
  agentNames: readonly string[] = [],
  channelNames: readonly string[] = [],
) =>
  renderApp(
    <FilterStrip
      filters={filters}
      channelNames={channelNames}
      labelNames={[]}
      agentNames={agentNames}
      onClearStatus={noop}
      onClearAssignment={noop}
      onClearSearch={noop}
      onClearChannel={noop}
      onClearLabels={noop}
      onClearAgents={noop}
      onClearSort={noop}
      onClearDates={noop}
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
        filters={{ ...DEFAULT_FILTERS, statuses: ['resolved'] }}
        channelNames={[]}
        labelNames={[]}
        agentNames={[]}
        onClearStatus={noop}
        onClearAssignment={noop}
        onClearSearch={noop}
        onClearChannel={noop}
        onClearLabels={noop}
        onClearAgents={noop}
        onClearSort={noop}
        onClearDates={noop}
        onClearArchived={noop}
        onClearAll={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /Sort:/ })).toBeNull();
  });
});

describe('FilterStrip: the filters the web has', () => {
  it('names every chosen status, in one chip', async () => {
    await show({ ...DEFAULT_FILTERS, statuses: ['snoozed', 'spam'] });
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Status: Snoozed, Spam' }),
    ).toBeTruthy();
  });
  it('names who has the conversation', async () => {
    await show({ ...DEFAULT_FILTERS, assignment: 'unattended' });
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Conversation: Unattended' }),
    ).toBeTruthy();
  });
  it('names the chosen channels', async () => {
    await show({ ...DEFAULT_FILTERS, channelIds: ['c1', 'c2'] }, [], ['Sales', 'Support']);
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Channel: Sales, Support' }),
    ).toBeTruthy();
  });
  it('counts the channels when their names are not known yet', async () => {
    await show({ ...DEFAULT_FILTERS, channelIds: ['c1', 'c2'] });
    expect(await screen.findByRole('button', { name: 'Remove filter: Channel: 2' })).toBeTruthy();
  });
  it('shows the date range, open at either end', async () => {
    await show({ ...DEFAULT_FILTERS, from: '2026-10-01', to: '' });
    expect(
      await screen.findByRole('button', {
        name: /Remove filter: Date range \(last activity\): 2026-10-01/,
      }),
    ).toBeTruthy();
  });
});
