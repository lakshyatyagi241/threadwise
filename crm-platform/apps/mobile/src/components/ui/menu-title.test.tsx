import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { MenuTitle } from './menu-title';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
] as const;

describe('MenuTitle', () => {
  it('shows the chosen view as the title', () => {
    renderApp(<MenuTitle label="Inbox view" options={OPTIONS} value="mine" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Inbox view' })).toBeTruthy();
    expect(screen.getByText(/Mine/)).toBeTruthy();
  });

  it('opens the list and reports the new choice', () => {
    const onChange = jest.fn();
    renderApp(<MenuTitle label="Inbox view" options={OPTIONS} value="all" onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Inbox view' }));
    fireEvent.press(screen.getByRole('menuitem', { name: /Unassigned/ }));
    expect(onChange).toHaveBeenCalledWith('unassigned');
  });
});
