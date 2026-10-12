import { render, screen } from '@testing-library/react-native';
import { Avatar, initialsOf } from './avatar';

describe('initialsOf', () => {
  it('takes the first letter of the first two words, in capitals', () => {
    expect(initialsOf('asha verma')).toBe('AV');
    expect(initialsOf('Asha Kumari Verma')).toBe('AK');
  });

  it('uses one letter for a single word', () => {
    expect(initialsOf('Asha')).toBe('A');
  });

  it('falls back to a question mark when there is no name', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('Avatar', () => {
  it('shows the initials', async () => {
    await render(<Avatar name="Asha Verma" />);
    expect(screen.getByText(/AV/, { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps the same mark for the same name', async () => {
    const { toJSON, rerender } = await render(<Avatar name="Asha Verma" />);
    const first = JSON.stringify(toJSON());
    await rerender(<Avatar name="Asha Verma" />);
    expect(JSON.stringify(toJSON())).toBe(first);
  });
});
