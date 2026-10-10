import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from './button';

describe('Button', () => {
  it('is a button named by its label, and shows the label (a trailing no-break space is invisible slack)', () => {
    render(<Button label="खाते तयार करा" onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'खाते तयार करा' });
    expect(button).toBeTruthy();
    expect(screen.getByText('खाते तयार करा')).toBeTruthy();
  });

  it('calls onPress, in every variant', () => {
    const onPress = jest.fn();
    render(
      <>
        <Button label="primary" onPress={onPress} />
        <Button label="secondary" variant="secondary" onPress={onPress} />
        <Button label="link" variant="link" align="start" onPress={onPress} />
      </>,
    );
    for (const name of ['primary', 'secondary', 'link']) {
      fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it('does nothing while loading or disabled, and says so to screen readers', () => {
    const onPress = jest.fn();
    const { rerender } = render(<Button label="Save" loading onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    rerender(<Button label="Save" disabled onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
