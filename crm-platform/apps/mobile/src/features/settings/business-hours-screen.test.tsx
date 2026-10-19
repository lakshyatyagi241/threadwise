import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import {
  ownerWorkweek,
  sessionManagesHours,
  sessionReadsHours,
  withBreak,
  workweek,
} from '@/test/business-hours-fixtures';
import { renderApp } from '@/test/render';
import * as api from './business-hours-api';
import { BusinessHoursScreen } from './business-hours-screen';

jest.mock('./business-hours-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const readCall = jest.mocked(api.fetchBusinessHours);
const saveCall = jest.mocked(api.saveBusinessHours);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(sessionManagesHours);
  readCall.mockResolvedValue(workweek);
});

describe('BusinessHoursScreen', () => {
  it('shows the seven days with their opening hours, and which are switched on', async () => {
    await renderApp(<BusinessHoursScreen />);
    expect((await screen.findByLabelText('Monday From')).props.value).toBe('09:00');
    expect(screen.getByLabelText('Monday To').props.value).toBe('18:00');
    expect(screen.getByRole('checkbox', { name: 'Monday' }).props.accessibilityState.checked).toBe(
      true,
    );
    expect(screen.getByRole('checkbox', { name: 'Sunday' }).props.accessibilityState.checked).toBe(
      false,
    );
    expect(
      screen.getByText(/Until you save, the workspace counts as open all the time/),
    ).toBeTruthy();
    expect(screen.getByText('Asia/Kolkata')).toBeTruthy();
  });

  it('says only the owner can change the time zone, to anyone else', async () => {
    await renderApp(<BusinessHoursScreen />);
    expect(
      await screen.findByText('Only the workspace owner can change the time zone.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Time zone' })).toBeNull();
  });

  it('saves the changed times without the time zone for a person who may not change it', async () => {
    saveCall.mockResolvedValue(workweek);
    await renderApp(<BusinessHoursScreen />);
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Saturday' }));
    await fill('Monday To', '1730');
    await press('Save hours');
    await waitFor(() => expect(saveCall).toHaveBeenCalledTimes(1));
    const body = saveCall.mock.calls[0]![0];
    expect(body).not.toHaveProperty('timezone');
    expect(body.days.mon).toMatchObject({ from: '09:00', to: '17:30' });
    expect(body.days.sat.enabled).toBe(true);
    expect(await screen.findByText('Business hours saved')).toBeTruthy();
  });

  it('lets the workspace owner pick the time zone, and saves it', async () => {
    readCall.mockResolvedValue(ownerWorkweek);
    saveCall.mockResolvedValue(ownerWorkweek);
    await renderApp(<BusinessHoursScreen />);
    await press('Time zone');
    await fireEvent.press(await screen.findByText('Europe/Berlin'));
    await press('Save hours');
    await waitFor(() =>
      expect(saveCall).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Europe/Berlin' })),
    );
    expect(screen.getByText('The time zone every day and time above is in.')).toBeTruthy();
  });

  it('checks the times before calling the API, and says what is wrong under the day', async () => {
    await renderApp(<BusinessHoursScreen />);
    await fill('Tuesday From', '');
    await fill('Wednesday To', '0900');
    await press('Save hours');
    expect(await screen.findByText('Enter both times.')).toBeTruthy();
    expect(screen.getByText('The opening and closing times must differ.')).toBeTruthy();
    expect(saveCall).not.toHaveBeenCalled();
  });

  it('says when a time is not a time of day', async () => {
    await renderApp(<BusinessHoursScreen />);
    await fill('Monday To', '99');
    await press('Save hours');
    expect(await screen.findByText('Use a time such as 09:00.')).toBeTruthy();
  });

  it('keeps a break set on the web through a save', async () => {
    readCall.mockResolvedValue(withBreak);
    saveCall.mockResolvedValue(withBreak);
    await renderApp(<BusinessHoursScreen />);
    await press('Save hours');
    await waitFor(() => expect(saveCall).toHaveBeenCalled());
    expect(saveCall.mock.calls[0]![0].days.mon.extra).toEqual([{ from: '14:00', to: '18:00' }]);
  });

  it('shows a failed save, and keeps what was typed', async () => {
    saveCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<BusinessHoursScreen />);
    await fill('Monday To', '1700');
    await press('Save hours');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect(screen.getByLabelText('Monday To').props.value).toBe('17:00');
  });

  it('says the plan has no auto-assignment when saving is refused for it', async () => {
    saveCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'));
    await renderApp(<BusinessHoursScreen />);
    await press('Save hours');
    expect(await screen.findByText(/which your plan does not include/)).toBeTruthy();
  });

  it('shows the hours but no way to change them for a person who may only read', async () => {
    jest.mocked(fetchSession).mockResolvedValue(sessionReadsHours);
    await renderApp(<BusinessHoursScreen />);
    expect(
      await screen.findByText('You can see the business hours but not change them.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Monday From').props.editable).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Monday' }).props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Save hours' })).toBeNull();
  });

  it('shows nothing, and asks for nothing, for a person who may not read the inbox settings', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderApp(<BusinessHoursScreen />);
    expect(
      await screen.findByText('You do not have permission to see the business hours.'),
    ).toBeTruthy();
    expect(readCall).not.toHaveBeenCalled();
  });

  it('explains a plan without auto-assignment instead of showing a form', async () => {
    readCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x'));
    await renderApp(<BusinessHoursScreen />);
    expect(await screen.findByText(/Business hours come with auto-assignment/)).toBeTruthy();
    expect(screen.queryByLabelText('Monday From')).toBeNull();
  });

  it('shows another failure with a way to try again', async () => {
    readCall
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'))
      .mockResolvedValue(workweek);
    await renderApp(<BusinessHoursScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText('Monday From')).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<BusinessHoursScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
