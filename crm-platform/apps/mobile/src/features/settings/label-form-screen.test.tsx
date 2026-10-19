import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { libraryOf, sessionManagesLabels, vip } from '@/test/labels-fixtures';
import { renderApp } from '@/test/render';
import * as api from './labels-api';
import { LabelFormScreen } from './label-form-screen';

jest.mock('./labels-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const listCall = jest.mocked(api.fetchLabelList);
const createCall = jest.mocked(api.createLabel);
const updateCall = jest.mocked(api.updateLabel);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);
const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesLabels);
  listCall.mockResolvedValue(libraryOf([vip]));
});

describe('LabelFormScreen: a new label', () => {
  it('checks the name and the colour before calling the API', async () => {
    await renderApp(<LabelFormScreen />);
    await fill('Color', 'red;');
    await press('Save changes');
    expect(await screen.findByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText(/Use a hex color such as #075E54/)).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('starts on the default colour, takes a swatch, and creates the label, then goes back', async () => {
    createCall.mockResolvedValue(vip);
    await renderApp(<LabelFormScreen />);
    expect((await screen.findByLabelText('Color')).props.value).toBe('#075E54');
    await fireEvent.press(screen.getByRole('radio', { name: '#2563EB' }));
    expect(screen.getByLabelText('Color').props.value).toBe('#2563EB');
    await fill('Name', ' VIP ');
    await fill('Description (optional)', 'Premium customers');
    await press('Save changes');
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({
        name: 'VIP',
        color: '#2563EB',
        description: 'Premium customers',
      }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('accepts a colour typed in by hand', async () => {
    createCall.mockResolvedValue(vip);
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'Urgent');
    await fill('Color', '#FF0000');
    await press('Save changes');
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({ name: 'Urgent', color: '#FF0000' }),
    );
  });

  it('puts the error under the name when it is taken', async () => {
    createCall.mockRejectedValue(new ApiError(409, 'CON_TAG_NAME_TAKEN', 'x'));
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'VIP');
    await press('Save changes');
    expect(await screen.findByText('A label with that name already exists.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says the plan limit was reached, and shows the offline sentence for a network failure', async () => {
    createCall
      .mockRejectedValueOnce(new ApiError(402, 'PLAN_LIMIT_REACHED', 'x'))
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'VIP');
    await press('Save changes');
    expect(await screen.findByText("You have reached your plan's limit of labels.")).toBeTruthy();
    await press('Save changes');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('puts a field the server refused under that field', async () => {
    createCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'x', undefined, [{ path: 'color', message: 'bad' }]),
    );
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'VIP');
    await press('Save changes');
    expect(await screen.findByText(/Use a hex color such as #075E54/)).toBeTruthy();
  });

  it('does not open for a person who may not manage labels', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<LabelFormScreen />);
    expect(await screen.findByText('You do not have permission to manage labels.')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});

describe('LabelFormScreen: editing a label', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ labelId: vip.id });
  });

  it('opens with the label filled in', async () => {
    await renderApp(<LabelFormScreen />);
    expect((await screen.findByLabelText('Name')).props.value).toBe('VIP');
    expect(screen.getByLabelText('Color').props.value).toBe('#2563EB');
    expect(screen.getByLabelText('Description (optional)').props.value).toBe(
      'Customers with a premium plan',
    );
    expect(screen.getByRole('radio', { name: '#2563EB' }).props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('saves with the version that was read, and clears an emptied description', async () => {
    updateCall.mockResolvedValue(vip);
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'Very important');
    await fill('Description (optional)', '');
    await press('Save changes');
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(vip.id, {
        rowVersion: 2,
        name: 'Very important',
        color: '#2563EB',
        description: null,
      }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('reloads the label and asks for a review when someone else changed it first', async () => {
    updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'));
    await renderApp(<LabelFormScreen />);
    await fill('Name', 'Mine');
    listCall.mockResolvedValue(libraryOf([{ ...vip, name: 'Theirs', rowVersion: 3 }]));
    await press('Save changes');
    expect(await screen.findByText(/Someone else changed this label first/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Name').props.value).toBe('Theirs'));
  });

  it('says the label was not found when it is gone from the library', async () => {
    listCall.mockResolvedValue(libraryOf([]));
    await renderApp(<LabelFormScreen />);
    expect(await screen.findByText(/could not be found/)).toBeTruthy();
  });

  it('offers to try again when the library could not be read', async () => {
    listCall
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'))
      .mockResolvedValue(libraryOf([vip]));
    await renderApp(<LabelFormScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText('Name')).toBeTruthy();
  });

  it('goes back to the list when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<LabelFormScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/labels');
  });
});
