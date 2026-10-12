import { render, screen } from '@testing-library/react-native';
import { Panel } from './panel';
import { Text } from './text';

describe('Panel', () => {
  it('shows a heading, the explanation under it, a trailing item and its content', async () => {
    await render(
      <Panel title="Active campaigns" subtitle="2 running" trailing={<Text>9 in all</Text>}>
        <Text>Inside</Text>
      </Panel>,
    );
    expect(screen.getByRole('header', { name: 'Active campaigns' })).toBeTruthy();
    expect(screen.getByText('2 running')).toBeTruthy();
    expect(screen.getByText('9 in all')).toBeTruthy();
    expect(screen.getByText('Inside')).toBeTruthy();
  });

  it('leaves out the explanation when there is none', async () => {
    await render(
      <Panel title="Integrations">
        <Text>Inside</Text>
      </Panel>,
    );
    expect(screen.queryByText('2 running')).toBeNull();
  });
});
