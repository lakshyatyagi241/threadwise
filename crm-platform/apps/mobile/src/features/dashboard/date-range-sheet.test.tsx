import { act, fireEvent, screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { DateRangePill, DateRangeSheet } from './date-range-sheet';

// 12 October 2026 is a Monday.
const TODAY = '2026-10-12';
const LAST_30 = { from: '2026-09-13', to: TODAY };

function sheet(overrides: Partial<Parameters<typeof DateRangeSheet>[0]> = {}) {
  return (
    <DateRangeSheet
      visible
      range={LAST_30}
      today={TODAY}
      onApply={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

const chip = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => chip(name).props.accessibilityState.checked;
const apply = () => screen.getByRole('button', { name: 'Apply' });
const selection = (from: string, to: string) =>
  screen.getByLabelText(`${from} to ${to}`, { exact: true });

describe('DateRangePill', () => {
  it('shows both dates with an arrow between and opens the calendar when pressed', async () => {
    const onPress = jest.fn();
    await renderApp(<DateRangePill range={LAST_30} onPress={onPress} />);
    expect(screen.getByText('2026-09-13')).toBeTruthy();
    expect(screen.getByText('2026-10-12')).toBeTruthy();
    const pill = screen.getByRole('button', { name: 'Date range: 2026-09-13 to 2026-10-12' });
    expect(pill.props.accessibilityHint).toBe('Opens the calendar to change the dates');
    await fireEvent.press(pill);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads in the language of the app', async () => {
    await initI18n('mr');
    try {
      await renderApp(<DateRangePill range={LAST_30} onPress={jest.fn()} />);
      expect(
        screen.getByRole('button', { name: 'तारखेची मर्यादा: 2026-09-13 ते 2026-10-12' }),
      ).toBeTruthy();
    } finally {
      // Back to English while the component is still on screen, so the change lands inside act().
      await act(async () => {
        await initI18n('en');
      });
    }
  });
});

describe('DateRangeSheet', () => {
  it('shows nothing while closed', async () => {
    await renderApp(sheet({ visible: false }));
    expect(screen.queryByText('Search by calendar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('opens on the current range, in its month, with the matching chip checked', async () => {
    await renderApp(sheet());
    expect(screen.getByRole('header', { name: 'Search by calendar' })).toBeTruthy();
    expect(selection('2026-09-13', '2026-10-12')).toBeTruthy();
    expect(screen.getByText('October 2026')).toBeTruthy();
    // The days of October inside the range are marked as such; the 1st is in it, the 13th (after today) is not selectable.
    expect(
      screen.getByRole('button', { name: 'Thursday, October 1, 2026, In range' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Monday, October 12, 2026, End of range, Today' }),
    ).toBeTruthy();
    expect(checked('Last 30 days')).toBe(true);
    expect(checked('Last 7 days')).toBe(false);
    expect(checked('Today')).toBe(false);
    expect(apply().props.accessibilityState.disabled).toBe(false);
  });

  it('offers the quick ranges in order, longest first', async () => {
    await renderApp(sheet());
    expect(screen.getByLabelText('Quick ranges').props.accessibilityRole).toBe('radiogroup');
    const names = screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel);
    expect(names).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days', 'Yesterday', 'Today']);
  });

  it('shows no chip as checked for a range of the person own', async () => {
    await renderApp(sheet({ range: { from: '2026-10-01', to: '2026-10-12' } }));
    for (const r of screen.getAllByRole('radio'))
      expect(r.props.accessibilityState.checked).toBe(false);
  });

  it('sets the selection from a chip', async () => {
    await renderApp(sheet());
    await fireEvent.press(chip('Last 7 days'));
    expect(selection('2026-10-06', '2026-10-12')).toBeTruthy();
    expect(checked('Last 7 days')).toBe(true);
    expect(checked('Last 30 days')).toBe(false);

    await fireEvent.press(chip('Yesterday'));
    expect(selection('2026-10-11', '2026-10-11')).toBeTruthy();
    expect(checked('Yesterday')).toBe(true);

    await fireEvent.press(chip('Last 90 days'));
    expect(selection('2026-07-15', '2026-10-12')).toBeTruthy();

    await fireEvent.press(chip('Today'));
    expect(selection('2026-10-12', '2026-10-12')).toBeTruthy();
    expect(checked('Today')).toBe(true);
  });

  it('moves the calendar to the month of the range a chip chose', async () => {
    await renderApp(sheet({ range: { from: '2026-05-02', to: '2026-05-10' } }));
    expect(screen.getByText('May 2026')).toBeTruthy();
    await fireEvent.press(chip('Today'));
    expect(screen.getByText('October 2026')).toBeTruthy();
    // And back to where the person was looking when they press the same chip with the calendar moved away.
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();
    await fireEvent.press(chip('Today'));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('uses the calendar to pick two days; Apply waits for the second', async () => {
    const onApply = jest.fn();
    await renderApp(sheet({ onApply }));
    await fireEvent.press(screen.getByRole('button', { name: /^Monday, October 5, 2026/ }));
    expect(apply().props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('2026-10-05')).toBeTruthy();
    expect(screen.getByText('Pick the last day')).toBeTruthy();
    for (const r of screen.getAllByRole('radio'))
      expect(r.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(apply());
    expect(onApply).not.toHaveBeenCalled();

    // The earlier day is the start whichever was pressed first.
    await fireEvent.press(screen.getByRole('button', { name: /^Friday, October 2, 2026/ }));
    expect(apply().props.accessibilityState.disabled).toBe(false);
    expect(selection('2026-10-02', '2026-10-05')).toBeTruthy();
    await fireEvent.press(apply());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ from: '2026-10-02', to: '2026-10-05' });
  });

  it('applies the current range as it is, and a chip choice', async () => {
    const onApply = jest.fn();
    await renderApp(sheet({ onApply }));
    await fireEvent.press(apply());
    expect(onApply).toHaveBeenLastCalledWith(LAST_30);
    await fireEvent.press(chip('Last 7 days'));
    await fireEvent.press(apply());
    expect(onApply).toHaveBeenLastCalledWith({ from: '2026-10-06', to: TODAY });
  });

  it('stops the second day at a year (366 days) from the first', async () => {
    await renderApp(sheet());
    await fireEvent.press(screen.getByRole('button', { name: /^Monday, October 12, 2026/ }));
    for (let i = 0; i < 12; i++) {
      await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    }
    expect(screen.getByText('October 2025')).toBeTruthy();
    // 12 October 2025 to 12 October 2026 is 366 days counting both ends; the 11th would be 367.
    const last = screen.getByRole('button', { name: /^Sunday, October 12, 2025/ });
    expect(last.props.accessibilityState.disabled).toBe(false);
    const tooFar = screen.getByRole('button', { name: /^Saturday, October 11, 2025/ });
    expect(tooFar.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(tooFar);
    expect(apply().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(last);
    expect(selection('2025-10-12', '2026-10-12')).toBeTruthy();
    expect(apply().props.accessibilityState.disabled).toBe(false);
  });

  it('puts the dashboard back on the last 30 days at once with Reset, without needing Apply', async () => {
    const onApply = jest.fn();
    await renderApp(sheet({ onApply, range: { from: '2026-05-02', to: '2026-05-10' } }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(LAST_30);
  });

  it('resets whatever was being chosen: another preset, or a half-made choice', async () => {
    const onApply = jest.fn();
    await renderApp(sheet({ onApply }));
    await fireEvent.press(chip('Today'));
    await fireEvent.press(screen.getByRole('button', { name: /^Monday, October 5, 2026/ }));
    expect(apply().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    expect(onApply).toHaveBeenCalledWith(LAST_30);
  });

  it('starts from the range again every time it opens', async () => {
    const view = await renderApp(sheet());
    await fireEvent.press(chip('Today'));
    expect(selection('2026-10-12', '2026-10-12')).toBeTruthy();
    await view.rerender(sheet({ visible: false }));
    expect(screen.queryByText('Search by calendar')).toBeNull();
    await view.rerender(sheet());
    expect(selection('2026-09-13', '2026-10-12')).toBeTruthy();
    expect(checked('Last 30 days')).toBe(true);
    // A new range from the parent shows on the next opening.
    await view.rerender(sheet({ visible: false }));
    await view.rerender(sheet({ range: { from: '2026-10-06', to: TODAY } }));
    expect(selection('2026-10-06', '2026-10-12')).toBeTruthy();
    expect(checked('Last 7 days')).toBe(true);
  });

  it('closes from the area above the sheet and from the screen reader escape gesture', async () => {
    const onClose = jest.fn();
    await renderApp(sheet({ onClose }));
    // The sheet is a modal view, so a screen reader skips the area around it: that button is for touch.
    await fireEvent.press(
      screen.getByRole('button', { name: 'Close calendar', includeHiddenElements: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByLabelText('Search by calendar'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is in the language of the app', async () => {
    await initI18n('hi');
    try {
      await renderApp(sheet());
      expect(screen.getByRole('header', { name: 'कैलेंडर से खोजें' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'पिछले 30 दिन' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'लागू करें' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'रीसेट करें' })).toBeTruthy();
    } finally {
      // Back to English while the component is still on screen, so the change lands inside act().
      await act(async () => {
        await initI18n('en');
      });
    }
  });
});
