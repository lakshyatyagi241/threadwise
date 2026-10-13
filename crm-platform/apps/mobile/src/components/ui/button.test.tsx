import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from './button';

describe('Button', () => {
  it('is a button named by its label, and shows the label (a trailing no-break space is invisible slack)', async () => {
    await render(<Button label="खाते तयार करा" onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'खाते तयार करा' });
    expect(button).toBeTruthy();
    expect(screen.getByText('खाते तयार करा')).toBeTruthy();
  });

  it('lets a screen reader hear more than the visible label, when the caller says so', async () => {
    await render(
      <Button
        label="Delete"
        accessibilityLabel="Delete note by Asha"
        variant="link"
        onPress={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete note by Asha' })).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onPress, in every variant', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Button label="primary" onPress={onPress} />
        <Button label="secondary" variant="secondary" onPress={onPress} />
        <Button label="link" variant="link" align="start" onPress={onPress} />
      </>,
    );
    for (const name of ['primary', 'secondary', 'link']) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it('does nothing while loading or disabled, and says so to screen readers', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<Button label="Save" loading onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await rerender(<Button label="Save" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
