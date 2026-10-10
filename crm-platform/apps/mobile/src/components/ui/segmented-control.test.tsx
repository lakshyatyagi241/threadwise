import { fireEvent, render, screen } from '@testing-library/react-native';
import { SegmentedControl } from './segmented-control';

const options = [
  { value: '7d', label: '7d', accessibilityLabel: 'Last 7 days' },
  { value: '30d', label: '30d', accessibilityLabel: 'Last 30 days' },
  { value: 'qtd', label: 'QTD' },
] as const;

describe('SegmentedControl', () => {
  it('is a group of radio buttons with the chosen one checked', () => {
    render(
      <SegmentedControl
        label="Date range"
        options={options}
        value="7d"
        onChange={() => undefined}
      />,
    );
    // The group itself is not one focus stop (that would hide the radio buttons inside it), so it is found by its label.
    expect(screen.getByLabelText('Date range').props.accessibilityRole).toBe('radiogroup');
    expect(
      screen.getByRole('radio', { name: 'Last 7 days' }).props.accessibilityState.checked,
    ).toBe(true);
    expect(
      screen.getByRole('radio', { name: 'Last 30 days' }).props.accessibilityState.checked,
    ).toBe(false);
  });

  it('uses the short label as the name when no longer name is given', () => {
    render(
      <SegmentedControl
        label="Date range"
        options={options}
        value="7d"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('radio', { name: 'QTD' })).toBeTruthy();
  });

  it('tells the screen which option was pressed', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl label="Date range" options={options} value="7d" onChange={onChange} />,
    );
    fireEvent.press(screen.getByRole('radio', { name: 'Last 30 days' }));
    expect(onChange).toHaveBeenCalledWith('30d');
  });
});
