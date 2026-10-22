import { render, screen } from '@testing-library/react-native';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('shows the Geta logo, sized to the tile it sits on', async () => {
    await render(<BrandMark size={100} />);
    const logo = screen.getByTestId('brand-logo', { includeHiddenElements: true });
    expect(logo.props.source).toBeTruthy();
    expect(logo.props.style).toMatchObject({ width: 78, height: 78 });
  });

  it('is decorative: the name is written next to it, so screen readers skip it', async () => {
    await render(<BrandMark />);
    expect(screen.queryByTestId('brand-logo')).toBeNull();
    expect(screen.getByTestId('brand-logo', { includeHiddenElements: true })).toBeTruthy();
  });
});
