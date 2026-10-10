import { fireEvent, render, screen } from '@testing-library/react-native';
import { Checkbox } from './checkbox';

const box = () => screen.getByRole('checkbox', { name: 'I agree to the terms.' });

describe('Checkbox', () => {
  it('is a checkbox with a name and a state, for screen readers', () => {
    render(<Checkbox checked={false} onChange={() => undefined} label="I agree to the terms." />);
    expect(box().props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  });

  it('asks for the opposite state when pressed', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <Checkbox checked={false} onChange={onChange} label="I agree to the terms." />,
    );
    fireEvent.press(box());
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Checkbox checked onChange={onChange} label="I agree to the terms." />);
    expect(box().props.accessibilityState.checked).toBe(true);
    fireEvent.press(box());
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', () => {
    const onChange = jest.fn();
    render(<Checkbox checked={false} disabled onChange={onChange} label="I agree to the terms." />);
    fireEvent.press(box());
    expect(onChange).not.toHaveBeenCalled();
  });
});
