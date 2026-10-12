import { fireEvent, render, screen } from '@testing-library/react-native';
import { Checkbox } from './checkbox';

const box = () => screen.getByRole('checkbox', { name: 'I agree to the terms.' });

describe('Checkbox', () => {
  it('is a checkbox with a name and a state, for screen readers', async () => {
    await render(
      <Checkbox checked={false} onChange={() => undefined} label="I agree to the terms." />,
    );
    expect(box().props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  });

  it('asks for the opposite state when pressed', async () => {
    const onChange = jest.fn();
    const { rerender } = await render(
      <Checkbox checked={false} onChange={onChange} label="I agree to the terms." />,
    );
    await fireEvent.press(box());
    expect(onChange).toHaveBeenLastCalledWith(true);

    await rerender(<Checkbox checked onChange={onChange} label="I agree to the terms." />);
    expect(box().props.accessibilityState.checked).toBe(true);
    await fireEvent.press(box());
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', async () => {
    const onChange = jest.fn();
    await render(
      <Checkbox checked={false} disabled onChange={onChange} label="I agree to the terms." />,
    );
    await fireEvent.press(box());
    expect(onChange).not.toHaveBeenCalled();
  });
});
