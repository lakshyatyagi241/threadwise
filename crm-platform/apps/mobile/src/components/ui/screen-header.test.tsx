import { fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { renderApp } from '@/test/render';
import { HeaderIconButton, ScreenHeader } from './screen-header';
import { Text } from './text';

const frame = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

describe('ScreenHeader', () => {
  it('shows the title and runs a button when it is pressed', () => {
    const onPress = jest.fn();
    renderApp(
      <SafeAreaProvider initialMetrics={frame}>
        <ScreenHeader actions={<HeaderIconButton icon="search" label="Search" onPress={onPress} />}>
          <Text>Inbox</Text>
        </ScreenHeader>
      </SafeAreaProvider>,
    );
    expect(screen.getByText(/Inbox/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('accepts a Material icon and a dot', () => {
    renderApp(
      <SafeAreaProvider initialMetrics={frame}>
        <ScreenHeader
          actions={
            <HeaderIconButton
              icon={{ material: 'filter-list' }}
              label="Filter"
              onPress={jest.fn()}
              dot
            />
          }
        >
          <Text>Contacts</Text>
        </ScreenHeader>
      </SafeAreaProvider>,
    );
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
  });
});
