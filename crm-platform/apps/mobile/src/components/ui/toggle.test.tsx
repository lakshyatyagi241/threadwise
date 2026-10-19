import { fireEvent, render, screen } from '@testing-library/react-native';
import { Toggle } from './toggle';

describe('Toggle', () => {
  it('is a switch with its label and state, and flips the other way when pressed', async () => {
    const onChange = jest.fn();
    await render(<Toggle label="Rule is active" value={false} onValueChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Rule is active' });
    expect(toggle.props.accessibilityState).toEqual({ checked: false, disabled: false });
    await fireEvent.press(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('turns an on switch off', async () => {
    const onChange = jest.fn();
    await render(<Toggle label="Rule is active" value onValueChange={onChange} />);
    expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does nothing when disabled, and says so', async () => {
    const onChange = jest.fn();
    await render(<Toggle label="Rule is active" value disabled onValueChange={onChange} />);
    expect(screen.getByRole('switch').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
