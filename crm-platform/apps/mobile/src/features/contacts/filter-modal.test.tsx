import { fireEvent, screen } from '@testing-library/react-native';
import { fetchSession } from '@/lib/session/api';
import { priya, rohan, sessionProps, statusOptions } from '@/test/contact-properties-fixtures';
import { renderApp } from '@/test/render';
import { initI18n } from '@/lib/i18n';
import * as contactsApi from './api';
import type { ContactFilters } from './api';
import { FilterModal } from './filter-modal';
import * as propertiesApi from './properties-api';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const assigneesCall = jest.mocked(propertiesApi.listAssignees);
const statusCall = jest.mocked(propertiesApi.listContactStatusOptions);
const heldCall = jest.mocked(contactsApi.getContactFilterValues);
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
  heldCall.mockResolvedValue({ lifecycleStages: [], statuses: [] });
});

describe('FilterModal (contacts)', () => {
  it('offers the categories of the Geta app, with the contact status beside the stage', async () => {
    await show();
    for (const name of [
      'Contact owner',
      'Lifecycle stage',
      'Status',
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

  it("filters by the workspace's statuses, sending the status value", async () => {
    await show();
    await tab('Status');
    // The ones of the workspace, retired ones left out, with an "Any" to clear it.
    expect(await screen.findByRole('radio', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Hot lead' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Retired' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hot lead' }));
    await apply();
    expect(applied()).toEqual({ status: 'Hot' });
  });

  it('also offers a stage and a status contacts hold that the workspace does not list', async () => {
    heldCall.mockResolvedValue({
      lifecycleStages: ['qualified', 'on_hold'],
      statuses: ['Won', 'Open'],
    });
    await show();
    await tab('Lifecycle stage');
    // Listed ones once, the unlisted one added in words.
    expect(await screen.findByRole('radio', { name: 'On Hold' })).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: 'Qualified' })).toHaveLength(1);
    await tab('Status');
    expect(await screen.findByRole('radio', { name: 'Won' })).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: 'Open' })).toHaveLength(1);
  });

  it('offers the four built-in statuses when the workspace has none', async () => {
    statusCall.mockResolvedValue([]);
    await show();
    await tab('Status');
    for (const name of ['Active', 'Prospect', 'Customer', 'VIP']) {
      expect(await screen.findByRole('radio', { name })).toBeTruthy();
    }
  });

  it('starts from the applied status and sends it back', async () => {
    await show({ status: 'Hot', lifecycleStage: 'qualified' });
    await tab('Status');
    expect(
      (await screen.findByRole('radio', { name: 'Hot lead' })).props.accessibilityState.checked,
    ).toBe(true);
    await apply();
    expect(applied()).toEqual({ status: 'Hot', lifecycleStage: 'qualified' });
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
