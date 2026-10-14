import { screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { ContactHero } from './contact-hero';

describe('ContactHero', () => {
  it('names the contact as the page header, with the line under it', async () => {
    await renderApp(<ContactHero name="Aarav Sharma" line="+919812345678" />);
    expect(screen.getByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.getByText('+919812345678')).toBeTruthy();
  });

  it('shows no second line when there is none', async () => {
    await renderApp(<ContactHero name="Aarav Sharma" line={null} />);
    expect(screen.getByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.queryByText('+919812345678')).toBeNull();
  });
});
