import { sortAssignees } from './assign-sheet';

const person = (
  name: string,
  availability: 'online' | 'away' | 'busy' | 'offline',
  isMe = false,
) => ({ name, availability, isMe });

describe('sortAssignees', () => {
  it('puts you first, then the others by availability as the web inbox does', () => {
    const sorted = sortAssignees([
      person('Anil', 'offline'),
      person('Bina', 'away'),
      person('Chetan', 'online'),
      person('Divya', 'busy'),
      person('Me', 'offline', true),
    ]);
    expect(sorted.map((u) => u.name)).toEqual(['Me', 'Chetan', 'Bina', 'Divya', 'Anil']);
  });

  it('keeps the API order (by name) inside the same availability', () => {
    const sorted = sortAssignees([
      person('Asha', 'online'),
      person('Bela', 'offline'),
      person('Charu', 'online'),
      person('Dev', 'offline'),
    ]);
    expect(sorted.map((u) => u.name)).toEqual(['Asha', 'Charu', 'Bela', 'Dev']);
  });

  it('does not change the list it was given', () => {
    const users = [person('Zed', 'offline'), person('Ann', 'online')];
    sortAssignees(users);
    expect(users.map((u) => u.name)).toEqual(['Zed', 'Ann']);
  });
});
