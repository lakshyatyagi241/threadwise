import { render, screen } from '@testing-library/react-native';
import { Text } from './text';
import { Card } from './card';

describe('Card', () => {
  it('shows what it holds', async () => {
    await render(
      <Card>
        <Text>Inside the card</Text>
      </Card>,
    );
    expect(screen.getByText('Inside the card')).toBeTruthy();
  });
});
