import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { PhoneField } from './phone-field';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const strings = {
  codeLabel: 'Country code',
  searchLabel: 'Search country',
  clearLabel: 'Clear',
  closeLabel: 'Close',
  emptyLabel: 'No match',
};

/** The field in a parent that keeps the value, as a form does; the last value is written where the test can read it. */
let latest = '';
function Host({ initial = '', error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    latest = value;
  }, [value]);
  return (
    <PhoneField
      label="Phone"
      value={value}
      onChangeText={setValue}
      defaultCountry="IN"
      locale="en"
      error={error}
      {...strings}
    />
  );
}

describe('PhoneField', () => {
  it('starts on the default country code and keeps the number as "+" and digits', async () => {
    await render(<Host />);
    expect(screen.getByRole('button', { name: 'Country code' }).props.accessibilityValue).toEqual({
      text: '+91',
    });
    await fireEvent.changeText(screen.getByLabelText('Phone'), '98765 43210');
    expect(latest).toBe('+919876543210');
    expect(screen.getByLabelText('Phone').props.value).toBe('9876543210');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '');
    expect(latest).toBe('');
  });

  it('starts from a stored number: its country in the code, the rest in the box', async () => {
    await render(<Host initial="+971501234567" />);
    expect(screen.getByRole('button', { name: 'Country code' }).props.accessibilityValue).toEqual({
      text: '+971',
    });
    expect(screen.getByLabelText('Phone').props.value).toBe('501234567');
  });

  it("changes the country from the picker's search and keeps the digits", async () => {
    await render(<Host initial="+919876543210" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Country code' }));
    await fireEvent.changeText(await screen.findByLabelText('Search country'), 'united arab');
    await fireEvent.press(
      await screen.findByRole('radio', { name: /United Arab Emirates, \+971/ }),
    );
    expect(screen.queryByLabelText('Search country')).toBeNull();
    expect(screen.getByRole('button', { name: 'Country code' }).props.accessibilityValue).toEqual({
      text: '+971',
    });
    expect(latest).toBe('+9719876543210');
  });

  it('finds a country by its calling code, and says when nothing matches', async () => {
    await render(<Host />);
    await fireEvent.press(screen.getByRole('button', { name: 'Country code' }));
    await fireEvent.changeText(await screen.findByLabelText('Search country'), '+44');
    expect(await screen.findByRole('radio', { name: /United Kingdom, \+44/ })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search country'), 'zzzzzz');
    expect(await screen.findByText('No match')).toBeTruthy();
  });

  it('lets a whole international number typed in pick the country by itself', async () => {
    await render(<Host />);
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+44 7911 123456');
    expect(latest).toBe('+447911123456');
    expect(screen.getByRole('button', { name: 'Country code' }).props.accessibilityValue).toEqual({
      text: '+44',
    });
    expect(screen.getByLabelText('Phone').props.value).toBe('7911123456');
  });

  it('shows the error under the field', async () => {
    await render(<Host error="Enter a valid phone number." />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Enter a valid phone number.')).toBeTruthy();
  });
});
