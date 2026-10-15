import { fireEvent, screen } from '@testing-library/react-native';
import { fetchSession } from '@/lib/session/api';
import { priya, rohan, sessionProps, statusOptions } from '@/test/contact-properties-fixtures';
import { renderApp } from '@/test/render';
import { initI18n } from '@/lib/i18n';
import type { ContactFilters } from './api';
import { FilterModal } from './filter-modal';
import * as propertiesApi from './properties-api';

jest.mock('./properties-api');
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const assigneesCall = jest.mocked(propertiesApi.listAssignees);
const statusCall = jest.mocked(propertiesApi.listContactStatusOptions);
const onApply = jest.fn();
const onClose = jest.fn();

async function show(filters: ContactFilters = {}) {
  await renderApp(<FilterModal filters={filters} onApply={onApply} onClose={onClose} />);
}
const tab = async (name: string) => fireEvent.press(await screen.findByRole('tab', { name }));
const apply = () => fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
const applied = () => onApply.mock.calls.at(-1)?.[0] as ContactFilters;

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.clearAllMocks();
  sessionCall.mockResolvedValue(sessionProps);
  assigneesCall.mockResolvedValue([priya, rohan]);
  statusCall.mockResolvedValue(statusOptions);
});

describe('FilterModal (contacts)', () => {
  it('offers the five categories, like the Geta app', async () => {
    await show();
    for (const name of [
      'Contact owner',
      'Lifecycle stage',
      'Created date',
      'Source',
      'Marketing messages',
    ]) {
      expect(await screen.findByRole('tab', { name })).toBeTruthy();
    }
  });

  it('filters by several owners and by "no owner", sending the ids comma-joined', async () => {
    await show();
    await fireEvent.press(
      await screen.findByRole('checkbox', { name: 'Priya Nair, priya@example.test' }),
    );
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan Das, rohan@example.test' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'No owner' }));
    await apply();
    expect(applied()).toEqual({ ownerIds: `${priya.id},${rohan.id}`, unassigned: true });
  });

  it('finds an owner by typing a part of the name', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Search contact owner'), 'roh');
    expect(screen.queryByRole('checkbox', { name: /Priya Nair/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Rohan Das/ })).toBeTruthy();
  });

  it('starts from the owners that are applied, and keeps the search words', async () => {
    await show({ q: 'aar', ownerIds: rohan.id, unassigned: true });
    expect(
      (await screen.findByRole('checkbox', { name: /Rohan Das/ })).props.accessibilityState.checked,
    ).toBe(true);
    expect(
      screen.getByRole('checkbox', { name: 'No owner' }).props.accessibilityState.checked,
    ).toBe(true);
    await apply();
    expect(applied()).toEqual({ q: 'aar', ownerIds: rohan.id, unassigned: true });
  });

  it("uses the workspace's own lifecycle stages", async () => {
    await show();
    await tab('Lifecycle stage');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Qualified' }));
    await apply();
    expect(applied()).toEqual({ lifecycleStage: 'qualified' });
  });

  it('sends the created window as createdFrom and createdTo', async () => {
    await show({ createdFrom: '2026-10-05', createdTo: '2026-10-09' });
    await tab('Created date');
    await apply();
    expect(applied()).toEqual({ createdFrom: '2026-10-05', createdTo: '2026-10-09' });
  });

  it('sends "Subscribed" as unsubscribed: false', async () => {
    await show();
    await tab('Marketing messages');
    await fireEvent.press(screen.getByRole('radio', { name: 'Subscribed' }));
    await apply();
    expect(applied()).toEqual({ unsubscribed: false });
  });

  it('closes with Back and sends nothing', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
