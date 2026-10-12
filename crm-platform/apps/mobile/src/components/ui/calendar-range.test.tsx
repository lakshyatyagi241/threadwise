import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { CalendarRange } from './calendar-range';

// 12 October 2026 is a Monday; 1 October is a Thursday.
const TODAY = '2026-10-12';

interface Value {
  from: string | null;
  to: string | null;
}

/** A parent that keeps the range the way a screen does, and records every call. */
function Host({
  initial = { from: null, to: null },
  maxSpanDays,
  onChange,
}: {
  initial?: Value;
  maxSpanDays?: number;
  onChange?: (from: string, to: string | null) => void;
}) {
  const [value, setValue] = useState<Value>(initial);
  return (
    <CalendarRange
      from={value.from}
      to={value.to}
      maxDate={TODAY}
      maxSpanDays={maxSpanDays}
      onChange={(from, to) => {
        onChange?.(from, to);
        setValue({ from, to });
      }}
    />
  );
}

const day = (label: string | RegExp) => screen.getByRole('button', { name: label });
const press = async (label: string | RegExp) => await fireEvent.press(day(label));

describe('CalendarRange: choosing days', () => {
  it('makes the first day pressed the start and leaves the end open', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await press(/^Monday, October 5, 2026/);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', null);
    expect(day(/^Monday, October 5, 2026/).props.accessibilityState.selected).toBe(true);
  });

  it('makes a later second day the end', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await press(/^Monday, October 5, 2026/);
    await press(/^Friday, October 9, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', '2026-10-09');
  });

  it('swaps the two when the second day is earlier than the first', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await press(/^Friday, October 9, 2026/);
    await press(/^Monday, October 5, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', '2026-10-09');
  });

  it('makes a range of one day when the same day is pressed twice', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await press(/^Monday, October 5, 2026/);
    await press(/^Monday, October 5, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', '2026-10-05');
  });

  it('starts over when a day is pressed after a complete range', async () => {
    const onChange = jest.fn();
    await renderApp(
      <Host initial={{ from: '2026-10-05', to: '2026-10-09' }} onChange={onChange} />,
    );
    await press(/^Wednesday, October 7, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-07', null);
    // The old end is gone from the screen too, and the new start is waiting for its end.
    expect(day(/^Friday, October 9, 2026/).props.accessibilityState.selected).toBe(false);
    await press(/^Thursday, October 8, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-07', '2026-10-08');
  });

  it('can take today as a day of the range', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await press(/^Monday, October 5, 2026/);
    await press(/^Monday, October 12, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-05', '2026-10-12');
  });
});

describe('CalendarRange: limits', () => {
  it('fades and disables the days after the last selectable one', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    const future = day(/^Tuesday, October 13, 2026/);
    expect(future.props.accessibilityState.disabled).toBe(true);
    expect(day(/^Monday, October 12, 2026/).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(future);
    expect(onChange).not.toHaveBeenCalled();
    await press(/^Monday, October 5, 2026/);
    await fireEvent.press(day(/^Saturday, October 31, 2026/));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('disables days that would make the range longer than the limit, on both sides of the start', async () => {
    const onChange = jest.fn();
    await renderApp(
      <Host initial={{ from: '2026-10-10', to: null }} maxSpanDays={3} onChange={onChange} />,
    );
    // 8, 9, 10 (the start), 11 and 12 are within 3 days of the 10th; the 7th would make it 4 days.
    for (const name of [
      /^Thursday, October 8, 2026/,
      /^Friday, October 9, 2026/,
      /^Sunday, October 11, 2026/,
      /^Monday, October 12, 2026/,
    ]) {
      expect(day(name).props.accessibilityState.disabled).toBe(false);
    }
    expect(day(/^Wednesday, October 7, 2026/).props.accessibilityState.disabled).toBe(true);
    expect(day(/^Tuesday, October 6, 2026/).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(day(/^Wednesday, October 7, 2026/));
    expect(onChange).not.toHaveBeenCalled();
    await press(/^Thursday, October 8, 2026/);
    expect(onChange).toHaveBeenCalledWith('2026-10-08', '2026-10-10');
  });

  it('allows a range of exactly the limit and not one day more', async () => {
    await renderApp(<Host initial={{ from: '2026-10-01', to: null }} maxSpanDays={5} />);
    expect(day(/^Monday, October 5, 2026/).props.accessibilityState.disabled).toBe(false);
    expect(day(/^Tuesday, October 6, 2026/).props.accessibilityState.disabled).toBe(true);
  });

  it('puts the limit away once the range is complete: any day starts a new one', async () => {
    const onChange = jest.fn();
    await renderApp(
      <Host
        initial={{ from: '2026-10-08', to: '2026-10-10' }}
        maxSpanDays={3}
        onChange={onChange}
      />,
    );
    expect(day(/^Thursday, October 1, 2026/).props.accessibilityState.disabled).toBe(false);
    await press(/^Thursday, October 1, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01', null);
    // ...and with a new start the limit applies from it.
    expect(day(/^Sunday, October 4, 2026/).props.accessibilityState.disabled).toBe(true);
  });

  it('has no limit when none is given', async () => {
    await renderApp(<Host initial={{ from: '2026-10-01', to: null }} />);
    expect(day(/^Monday, October 12, 2026/).props.accessibilityState.disabled).toBe(false);
  });
});

describe('CalendarRange: months', () => {
  it('opens on the month of the end, else the start, else the last selectable day', async () => {
    const view = await renderApp(
      <CalendarRange
        from="2026-08-20"
        to="2026-09-03"
        maxDate={TODAY}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('September 2026')).toBeTruthy();
    await view.rerender(
      <CalendarRange from="2026-08-20" to={null} maxDate={TODAY} onChange={() => undefined} />,
    );
    // The month stays where the person put it; a new calendar (a new key) starts from the new range.
    expect(screen.getByText('September 2026')).toBeTruthy();
    await view.rerender(
      <CalendarRange
        key="a"
        from="2026-08-20"
        to={null}
        maxDate={TODAY}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('August 2026')).toBeTruthy();
    await view.rerender(
      <CalendarRange key="b" from={null} to={null} maxDate={TODAY} onChange={() => undefined} />,
    );
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('goes back and forward a month, and the next button stops at the month of the last selectable day', async () => {
    await renderApp(<Host />);
    const next = () => screen.getByRole('button', { name: 'Next month' });
    expect(next().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(next());
    expect(screen.getByText('October 2026')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(next().props.accessibilityState.disabled).toBe(false);
    // September has no day after the 30th and starts on a Tuesday.
    expect(screen.getByRole('button', { name: /^Tuesday, September 1, 2026/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /October/ })).toBeNull();

    await fireEvent.press(next());
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(next().props.accessibilityState.disabled).toBe(true);
  });

  it('crosses a year going back', async () => {
    await renderApp(<Host />);
    const previous = () => screen.getByRole('button', { name: 'Previous month' });
    for (let i = 0; i < 10; i++) await fireEvent.press(previous());
    expect(screen.getByText('December 2025')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Wednesday, December 31, 2025/ })).toBeTruthy();
  });

  it('keeps a range across a month change and lets it be finished in another month', async () => {
    const onChange = jest.fn();
    await renderApp(<Host onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await press(/^Tuesday, September 29, 2026/);
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    await press(/^Thursday, October 1, 2026/);
    expect(onChange).toHaveBeenLastCalledWith('2026-09-29', '2026-10-01');
    expect(day(/^Thursday, October 1, 2026/).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(day(/^Wednesday, September 30, 2026, In range/).props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('shows 29 February in a leap year only', async () => {
    const view = await renderApp(
      <CalendarRange from="2024-02-10" to="2024-02-12" maxDate="2026-10-12" onChange={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: /^Thursday, February 29, 2024/ })).toBeTruthy();
    await view.rerender(
      <CalendarRange
        key="2023"
        from="2023-02-10"
        to="2023-02-12"
        maxDate="2026-10-12"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Tuesday, February 28, 2023/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /February 29/ })).toBeNull();
  });
});

describe('CalendarRange: what a screen reader and a sighted person get', () => {
  it('names the month grid and marks the state of every day of a range', async () => {
    await renderApp(<Host initial={{ from: '2026-10-05', to: '2026-10-09' }} />);
    expect(screen.getByLabelText('October 2026').props.role).toBe('grid');

    const start = day('Monday, October 5, 2026, Start of range');
    expect(start.props.accessibilityState).toEqual({ selected: true, disabled: false });
    const inside = day('Wednesday, October 7, 2026, In range');
    expect(inside.props.accessibilityState).toEqual({ selected: true, disabled: false });
    const end = day('Friday, October 9, 2026, End of range');
    expect(end.props.accessibilityState).toEqual({ selected: true, disabled: false });

    const outside = day('Saturday, October 10, 2026');
    expect(outside.props.accessibilityState).toEqual({ selected: false, disabled: false });
    const before = day('Sunday, October 4, 2026');
    expect(before.props.accessibilityState).toEqual({ selected: false, disabled: false });
  });

  it('says which day is today, the last selectable one', async () => {
    await renderApp(<Host />);
    expect(day('Monday, October 12, 2026, Today')).toBeTruthy();
    expect(day('Sunday, October 11, 2026')).toBeTruthy();
  });

  it('adds today to its range state', async () => {
    await renderApp(<Host initial={{ from: '2026-10-08', to: '2026-10-12' }} />);
    expect(day('Monday, October 12, 2026, End of range, Today')).toBeTruthy();
  });

  it('calls a one-day range both the start and the end', async () => {
    await renderApp(<Host initial={{ from: '2026-10-07', to: '2026-10-07' }} />);
    expect(day('Wednesday, October 7, 2026, Start of range, End of range')).toBeTruthy();
  });

  it('marks only the start while the end is still to be chosen', async () => {
    await renderApp(<Host initial={{ from: '2026-10-07', to: null }} />);
    expect(
      day('Wednesday, October 7, 2026, Start of range').props.accessibilityState.selected,
    ).toBe(true);
    expect(day('Thursday, October 8, 2026').props.accessibilityState.selected).toBe(false);
  });

  it('shows the short weekday names Sunday first, hidden from screen readers (each day already says its weekday)', async () => {
    await renderApp(<Host />);
    expect(screen.queryByText('Sun')).toBeNull();
    for (const name of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByText(name, { includeHiddenElements: true })).toBeTruthy();
    }
    const names = screen
      .getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/, { includeHiddenElements: true })
      .map((n) => n.props.children);
    expect(names).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('gives a month the header role, so it is announced when it changes', async () => {
    await renderApp(<Host />);
    expect(screen.getByRole('header', { name: 'October 2026' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeTruthy();
  });

  it('shows ignored cells of the neighbouring months as nothing at all', async () => {
    await renderApp(<Host />);
    // 31 days of October and the two month buttons: nothing else can be pressed.
    expect(screen.getAllByRole('button')).toHaveLength(31 + 2);
  });

  it('writes the month and the days in the language of the app, with ordinary digits', async () => {
    await initI18n('hi');
    try {
      await renderApp(<Host initial={{ from: '2026-10-05', to: '2026-10-09' }} />);
      expect(screen.getByRole('button', { name: 'पिछला महीना' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /सीमा का पहला दिन/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /सीमा का आख़िरी दिन/ })).toBeTruthy();
      for (const button of screen.getAllByRole('button')) {
        expect(button.props.accessibilityLabel).not.toMatch(/[०-९]/);
      }
    } finally {
      await act(async () => {
        await initI18n('en');
      });
    }
  });
});
