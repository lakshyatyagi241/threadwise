import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from './text';
import { TextField } from './text-field';

describe('TextField', () => {
  it('names the input by its label and passes typing through', () => {
    const onChangeText = jest.fn();
    render(<TextField label="Work email" value="" onChangeText={onChangeText} />);
    fireEvent.changeText(screen.getByLabelText('Work email'), 'a@b.test');
    expect(onChangeText).toHaveBeenCalledWith('a@b.test');
  });

  it('shows the hint, and replaces it with the error when there is one', () => {
    const { rerender } = render(
      <TextField
        label="Phone"
        value=""
        hint="We use it to verify you."
        onChangeText={() => undefined}
      />,
    );
    expect(screen.getByText('We use it to verify you.')).toBeTruthy();
    expect(screen.getByLabelText('Phone').props.accessibilityHint).toBe('We use it to verify you.');

    rerender(
      <TextField
        label="Phone"
        value=""
        hint="We use it to verify you."
        error="Enter your mobile number."
        onChangeText={() => undefined}
      />,
    );
    expect(screen.queryByText('We use it to verify you.')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Enter your mobile number.')).toBeTruthy();
  });

  it('still tells the caller when it gains and loses focus', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    render(
      <TextField
        label="Name"
        value=""
        onChangeText={() => undefined}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    fireEvent(screen.getByLabelText('Name'), 'focus');
    fireEvent(screen.getByLabelText('Name'), 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows what sits at the end of the field', () => {
    render(
      <TextField label="Name" value="" onChangeText={() => undefined} end={<Text>suffix</Text>} />,
    );
    expect(screen.getByText('suffix')).toBeTruthy();
  });
});
