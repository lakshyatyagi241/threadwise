import { fireEvent, screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { FilterPanes, type FilterCategory } from './filter-panes';

const categories: FilterCategory[] = [
  {
    key: 'owner',
    title: 'Contact owner',
    kind: 'multi',
    searchLabel: 'Search contact owner',
    options: [
      { value: 'a', label: 'Ashish Surve', hint: 'ashish@example.test' },
      { value: 'b', label: 'Prasad Chaudhari' },
      { value: 'c', label: 'Akash Badiyani' },
    ],
  },
  {
    key: 'stage',
    title: 'Lead stage',
    kind: 'single',
    options: [
      { value: '', label: 'Any' },
      { value: 'new', label: 'New' },
      { value: 'won', label: 'Won' },
    ],
  },
  { key: 'created', title: 'Created date', kind: 'dates', maxDate: '2026-10-15' },
  { key: 'source', title: 'Source', kind: 'text', label: 'Source field' },
  {
    key: 'status',
    title: 'Status',
    kind: 'single',
    empty: 'default',
    options: [
      { value: 'default', label: 'Open and pending' },
      { value: 'closed', label: 'Closed' },
    ],
  },
];

const onApply = jest.fn();
const onClose = jest.fn();

async function show(value: Record<string, string> = {}) {
  await renderApp(
    <FilterPanes
      visible
      title="Filters"
      categories={categories}
      value={value}
      onApply={onApply}
      onClose={onClose}
    />,
  );
}
const tab = (name: string) => fireEvent.press(screen.getByRole('tab', { name }));
const apply = () => fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
const applied = () => onApply.mock.calls.at(-1)?.[0] as Record<string, string>;

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => jest.clearAllMocks());

describe('FilterPanes', () => {
  it('lists the categories on the left and opens the first one', async () => {
    await show();
    expect(screen.getByRole('header', { name: 'Filters' })).toBeTruthy();
    for (const name of ['Contact owner', 'Lead stage', 'Created date', 'Source', 'Status']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect(
      screen.getByRole('tab', { name: 'Contact owner' }).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByRole('checkbox', { name: 'Ashish Surve, ashish@example.test' }),
    ).toBeTruthy();
  });

  it('ticks several people, finds one by typing, and sends them comma-joined', async () => {
    await show();
    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Ashish Surve, ashish@example.test' }),
    );
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Akash Badiyani' }));
    await fireEvent.changeText(screen.getByLabelText('Search contact owner'), 'prasad');
    expect(screen.queryByRole('checkbox', { name: 'Akash Badiyani' })).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Prasad Chaudhari' }));
    await apply();
    expect(applied().owner).toBe('a,c,b');
    // Ticking a ticked one takes it off.
    await fireEvent.changeText(screen.getByLabelText('Search contact owner'), '');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Akash Badiyani' }));
    await apply();
    expect(applied().owner).toBe('a,b');
  });

  it('says when a search finds nobody', async () => {
    await show();
    await fireEvent.changeText(screen.getByLabelText('Search contact owner'), 'zzz');
    expect(await screen.findByText('Nothing matches your search.')).toBeTruthy();
  });

  it('keeps one choice per single category, across the categories', async () => {
    await show();
    await tab('Lead stage');
    await fireEvent.press(screen.getByRole('radio', { name: 'New' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Won' }));
    expect(screen.getByRole('radio', { name: 'New' }).props.accessibilityState.checked).toBe(false);
    await tab('Source');
    await fireEvent.changeText(screen.getByLabelText('Source field'), 'import');
    await apply();
    expect(applied()).toMatchObject({
      stage: 'won',
      source: 'import',
      owner: '',
      status: 'default',
    });
  });

  it('starts from what is applied, including a category whose own default is a real value', async () => {
    await show({ owner: 'b', stage: 'new', status: 'closed' });
    expect(
      screen.getByRole('checkbox', { name: 'Prasad Chaudhari' }).props.accessibilityState.checked,
    ).toBe(true);
    await tab('Status');
    expect(screen.getByRole('radio', { name: 'Closed' }).props.accessibilityState.checked).toBe(
      true,
    );
    await apply();
    expect(applied()).toMatchObject({ owner: 'b', stage: 'new', status: 'closed' });
  });

  it('Clear all takes every filter off and applies at once', async () => {
    await show({ owner: 'b', stage: 'new', status: 'closed' });
    await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // The status goes back to its own default, not to nothing.
    expect(applied()).toEqual({
      owner: '',
      stage: '',
      created: '',
      source: '',
      status: 'default',
    });
  });

  it('takes a range of days from the calendar, as from,to', async () => {
    await show();
    await tab('Created date');
    await fireEvent.press(screen.getByRole('button', { name: /^Monday, October 5, 2026/ }));
    await apply();
    expect(applied().created).toBe('2026-10-05,');
    await fireEvent.press(screen.getByRole('button', { name: /^Friday, October 9, 2026/ }));
    await apply();
    expect(applied().created).toBe('2026-10-05,2026-10-09');
  });

  it('shows the applied range selected when it opens', async () => {
    await show({ created: '2026-10-05,2026-10-09' });
    await tab('Created date');
    expect(
      screen.getByRole('button', { name: /^Monday, October 5, 2026/ }).props.accessibilityState
        .selected,
    ).toBe(true);
  });

  it('goes back without applying', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows a dot beside a category that holds a choice', async () => {
    await show({ stage: 'won' });
    const stageTab = screen.getByRole('tab', { name: 'Lead stage' });
    const ownerTab = screen.getByRole('tab', { name: 'Contact owner' });
    // The dot is the tab's second child: present on a set category, absent on an empty one.
    expect(stageTab.children.length).toBeGreaterThan(ownerTab.children.length);
  });

  it('says why the options could not all be loaded, and stays usable', async () => {
    await renderApp(
      <FilterPanes
        visible
        title="Filters"
        categories={categories}
        value={{}}
        error="Can't reach the server."
        onApply={onApply}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Can't reach the server.")).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Prasad Chaudhari' })).toBeTruthy();
  });
});
