import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { channelRow } from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { DEFAULT_FILTERS } from './filters';
import { FiltersSheet, idsApplied, type SheetFilters } from './filters-sheet';
import * as labelsApi from './labels-api';

jest.mock('./api');
jest.mock('./labels-api');

const assigneesCall = jest.mocked(api.fetchAssignees);
const channelsCall = jest.mocked(api.fetchChannels);
const libraryCall = jest.mocked(labelsApi.fetchLabelLibrary);

const value = (over: Partial<SheetFilters> = {}): SheetFilters => ({
  statuses: DEFAULT_FILTERS.statuses,
  assignment: DEFAULT_FILTERS.assignment,
  channelIds: [],
  labels: [],
  archived: false,
  agentIds: [],
  sort: 'recent',
  from: '',
  to: '',
  ...over,
});

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  channelsCall.mockResolvedValue({ data: [channelRow()] });
  libraryCall.mockResolvedValue([]);
  assigneesCall.mockResolvedValue({ users: [], teams: [] });
});

describe('idsApplied', () => {
  it('keeps what was on when the category was not offered', () => {
    expect(idsApplied(undefined, ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('applies an empty pick as none, and a pick as it is', () => {
    expect(idsApplied('', ['a'])).toEqual([]);
    expect(idsApplied('x,y', ['a'])).toEqual(['x', 'y']);
  });
  it('keeps at most 20, the most one request may name', () => {
    const many = Array.from({ length: 25 }, (_, i) => `id${i}`);
    expect(idsApplied(many.join(','), [])).toHaveLength(20);
  });
});

describe('FiltersSheet: the agent filter survives an Apply when the agents are not available', () => {
  it('keeps the chosen agents when the list of agents has not loaded, and applies the new sort', async () => {
    assigneesCall.mockResolvedValue({ users: [], teams: [] });
    const onApply = jest.fn();
    await renderApp(
      <FiltersSheet
        visible
        value={value({ agentIds: ['a1', 'a2'] })}
        onApply={onApply}
        onClose={jest.fn()}
      />,
    );
    await fireEvent.press(await screen.findByRole('tab', { name: 'Sort by' }));
    await fireEvent.press(await screen.findByRole('radio', { name: /Oldest first/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ agentIds: ['a1', 'a2'], sort: 'old' }),
    );
  });

  it('says under "Oldest first" that pinned conversations are not kept on top', async () => {
    await renderApp(
      <FiltersSheet visible value={value()} onApply={jest.fn()} onClose={jest.fn()} />,
    );
    await fireEvent.press(await screen.findByRole('tab', { name: 'Sort by' }));
    expect(await screen.findByText('Pinned conversations are not kept on top.')).toBeTruthy();
  });
});

describe('FiltersSheet: the same filters as the web', () => {
  it('lists chat status, conversation, sort by and the date range, then the channels the workspace has', async () => {
    await renderApp(
      <FiltersSheet visible value={value()} onApply={jest.fn()} onClose={jest.fn()} />,
    );
    const names = (await screen.findAllByRole('tab')).map((tab) => tab.props.accessibilityLabel);
    expect(names.slice(0, 4)).toEqual([
      'Chat status',
      'Conversation',
      'Sort by',
      'Date range (last activity)',
    ]);
    expect(names).toContain('Channel');
    expect(names[names.length - 1]).toBe('View');
  });

  it('offers resolved and spam but no separate "Closed", and takes several statuses at once', async () => {
    const onApply = jest.fn();
    await renderApp(<FiltersSheet visible value={value()} onApply={onApply} onClose={jest.fn()} />);
    expect(await screen.findByRole('checkbox', { name: 'Spam' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Closed' })).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Spam' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Snoozed' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    // In the order the window lists them, whatever order they were ticked in.
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['snoozed', 'spam'] }),
    );
  });

  it('applies who has the conversation, and "Any" takes it off', async () => {
    const onApply = jest.fn();
    await renderApp(
      <FiltersSheet
        visible
        value={value({ assignment: 'assigned' })}
        onApply={onApply}
        onClose={jest.fn()}
      />,
    );
    await fireEvent.press(await screen.findByRole('tab', { name: 'Conversation' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Unattended' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ assignment: 'unattended' }));

    onApply.mockClear();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Any' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ assignment: '' }));
  });

  it('keeps the chosen channels and dates when only the sort changes', async () => {
    const onApply = jest.fn();
    await renderApp(
      <FiltersSheet
        visible
        value={value({ channelIds: ['ch1'], from: '2026-10-01', to: '2026-10-20' })}
        onApply={onApply}
        onClose={jest.fn()}
      />,
    );
    await fireEvent.press(await screen.findByRole('tab', { name: 'Sort by' }));
    await fireEvent.press(await screen.findByRole('radio', { name: /Oldest first/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        channelIds: ['ch1'],
        from: '2026-10-01',
        to: '2026-10-20',
        sort: 'old',
      }),
    );
  });
});
