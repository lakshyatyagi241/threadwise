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
  status: DEFAULT_FILTERS.status,
  channelId: '',
  labels: [],
  archived: false,
  agentIds: [],
  sort: 'recent',
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
