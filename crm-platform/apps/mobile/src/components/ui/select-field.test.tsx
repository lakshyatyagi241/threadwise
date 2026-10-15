import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { SelectField } from './select-field';

const OPTIONS = [
  { value: 'a', label: 'Asha' },
  { value: 'r', label: 'Rohan' },
] as const;

describe('SelectField', () => {
  it('shows the placeholder until something is chosen, then the chosen label', async () => {
    const view = await renderApp(
      <SelectField
        label="Agent"
        placeholder="Pick one"
        options={OPTIONS}
        value={undefined}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('Pick one')).toBeTruthy();
    await view.rerender(
      <SelectField
        label="Agent"
        placeholder="Pick one"
        options={OPTIONS}
        value="r"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Agent' }).props.accessibilityValue).toEqual({
      text: 'Rohan',
    });
  });

  it('opens the list, reports the choice and closes', async () => {
    const onChange = jest.fn();
    await renderApp(
      <SelectField
        label="Agent"
        placeholder="Pick one"
        options={OPTIONS}
        value="a"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('radio', { name: 'Asha' }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole('radio', { name: 'Rohan' }));
    expect(onChange).toHaveBeenCalledWith('r');
  });
});
