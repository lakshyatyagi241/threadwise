import { describe, expect, it } from 'vitest';
import { editorItems, editorState } from './quick-access';

describe('quick access editor (TW-DASH-009)', () => {
  it('saves ticked pages in catalog order, then custom rows, and skips half-filled rows', () => {
    expect(
      editorItems(
        ['analytics', 'inbox'],
        [
          { label: 'Mine', url: '/m' },
          { label: '', url: '/x' },
        ],
      ),
    ).toEqual([{ key: 'inbox' }, { key: 'analytics' }, { label: 'Mine', url: '/m' }]);
  });

  it('splits the saved items back into keys and rows', () => {
    expect(editorState([{ key: 'deals' }, { label: 'A', url: '/a' }])).toEqual({
      keys: ['deals'],
      rows: [{ label: 'A', url: '/a' }],
    });
  });
});
