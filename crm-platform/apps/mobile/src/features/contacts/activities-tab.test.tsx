import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { ActivitiesTab } from './activities-tab';

jest.mock('./activity-summary', () => ({
  ActivitySummary: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('@/components/ui/text');
    return <Text>activity summary</Text>;
  },
}));
jest.mock('./activity-tab', () => ({
  ActivityTab: ({ hideTiles }: { hideTiles?: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('@/components/ui/text');
    return <Text>{hideTiles ? 'timeline without tiles' : 'timeline with tiles'}</Text>;
  },
}));

const press = jest.fn();
const actions = [{ key: 'call', icon: 'call-outline' as const, label: 'Call', onPress: press }];

describe('ActivitiesTab', () => {
  it('opens on the shortcuts and the summary', async () => {
    await renderApp(<ActivitiesTab contactId="c1" canUpdate actions={actions} />);
    expect(screen.getByText('activity summary')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Call' }));
    expect(press).toHaveBeenCalled();
    expect(screen.queryByText('timeline without tiles')).toBeNull();
  });

  it('switches to the timeline, without repeating the notes and tasks tiles, and back', async () => {
    await renderApp(<ActivitiesTab contactId="c1" canUpdate actions={actions} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Activity timeline' }));
    expect(screen.getByText('timeline without tiles')).toBeTruthy();
    expect(screen.queryByText('activity summary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'All activities' }));
    expect(screen.getByText('activity summary')).toBeTruthy();
  });
});
