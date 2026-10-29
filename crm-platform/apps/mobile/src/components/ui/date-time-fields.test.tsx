import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fireEvent, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { renderApp } from '@/test/render';
import { TimeField } from './date-time-fields';

jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
}));

const open = jest.mocked(DateTimePickerAndroid.open);

const show = (value: string, onChange = jest.fn()) =>
  renderApp(
    <TimeField
      label="Time"
      placeholder="Select time"
      clearLabel="Clear"
      hourLabel="Hour"
      minuteLabel="Minute"
      doneLabel="Done"
      value={value}
      onChange={onChange}
    />,
  );

beforeEach(() => jest.resetAllMocks());

describe('the time field on Android', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens the system clock dialog, starting on the time already chosen', async () => {
    await show('16:57');
    await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
    expect(open).toHaveBeenCalledTimes(1);
    const props = open.mock.calls[0]![0];
    expect(props.mode).toBe('time');
    expect(props.value.getHours()).toBe(16);
    expect(props.value.getMinutes()).toBe(57);
    // The app's own hour and minute sheet is not drawn.
    expect(screen.queryByLabelText('Hour')).toBeNull();
  });

  it('hands back the time picked as HH:mm, with the hour on the 24-hour clock', async () => {
    const onChange = jest.fn();
    await show('', onChange);
    await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
    open.mock.calls[0]![0].onValueChange?.({} as never, new Date(2026, 9, 29, 16, 5));
    expect(onChange).toHaveBeenCalledWith('16:05');
  });

  it('offers Clear inside the dialog only while a time is set, and clears with it', async () => {
    const onChange = jest.fn();
    await show('09:30', onChange);
    await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
    const props = open.mock.calls[0]![0];
    expect(props.neutralButton).toEqual({ label: 'Clear' });
    props.onNeutralButtonPress?.();
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('has no Clear button when there is no time yet, and changes nothing when dismissed', async () => {
    const onChange = jest.fn();
    await show('', onChange);
    await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
    expect(open.mock.calls[0]![0].neutralButton).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
  });
});
