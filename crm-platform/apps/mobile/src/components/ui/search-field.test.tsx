import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchField } from './search-field';

describe('SearchField', () => {
  it('names the input, shows the placeholder and passes typing through', async () => {
    const onChangeText = jest.fn();
    await render(
      <SearchField
        label="Search fields"
        placeholder="Search fields"
        clearLabel="Clear search"
        value=""
        onChangeText={onChangeText}
      />,
    );
    const input = screen.getByLabelText('Search fields');
    expect(input.props.placeholder).toBe('Search fields');
    await fireEvent.changeText(input, 'city');
    expect(onChangeText).toHaveBeenCalledWith('city');
  });

  it('offers a clear button only once something is typed, and it empties the box', async () => {
    const onChangeText = jest.fn();
    const { rerender } = await render(
      <SearchField label="Search" clearLabel="Clear search" value="" onChangeText={onChangeText} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await rerender(
      <SearchField
        label="Search"
        clearLabel="Clear search"
        value="pune"
        onChangeText={onChangeText}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('still tells the caller when it gains and loses focus', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    await render(
      <SearchField
        label="Search"
        clearLabel="Clear"
        value=""
        onChangeText={() => undefined}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    await fireEvent(screen.getByLabelText('Search'), 'focus');
    await fireEvent(screen.getByLabelText('Search'), 'blur');
    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
  });
});
