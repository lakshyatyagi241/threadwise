import { screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('says what is missing and what to do', () => {
    renderApp(
      <EmptyState icon="people-outline" title="No contacts" hint="Add your first contact." />,
    );
    expect(screen.getByText(/No contacts/)).toBeTruthy();
    expect(screen.getByText(/Add your first contact\./)).toBeTruthy();
  });

  it('works without a hint', () => {
    renderApp(<EmptyState icon="people-outline" title="No contacts" />);
    expect(screen.queryByText(/Add your first/)).toBeNull();
  });
});
