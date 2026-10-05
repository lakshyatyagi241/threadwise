import { describe, expect, it } from 'vitest';
import type { MessengerSetup } from '@crm/contracts';
import {
  ICE_MAX,
  MENU_MAX,
  addRow,
  blankIceBreaker,
  blankMenuItem,
  firstTab,
  iceBreakerPreview,
  menuPreviewTitles,
  patchRow,
  removeRow,
  seedRows,
  tabsSet,
} from './setup-model';

const view = (over: Partial<MessengerSetup> = {}): MessengerSetup => ({
  pages: [],
  page: null,
  getStarted: '',
  greeting: '',
  menu: { items: [], composerInputDisabled: false },
  iceBreakers: [],
  ...over,
});

describe('repeatable rows (WD-FB-015)', () => {
  it('a group with nothing saved opens on one blank row', () => {
    expect(seedRows([], blankMenuItem)).toEqual([blankMenuItem()]);
    expect(seedRows([{ question: 'q', payload: 'p' }], blankIceBreaker)).toHaveLength(1);
  });

  it('adding stops at the cap: three menu items, four ice breakers', () => {
    let menu = seedRows([], blankMenuItem);
    for (let i = 0; i < 6; i++) menu = addRow(menu, blankMenuItem, MENU_MAX);
    expect(menu).toHaveLength(3);
    let ice = seedRows([], blankIceBreaker);
    for (let i = 0; i < 6; i++) ice = addRow(ice, blankIceBreaker, ICE_MAX);
    expect(ice).toHaveLength(4);
  });

  it('removing drops a row, and the last remaining row is cleared instead of removed', () => {
    const rows = [
      { question: 'a', payload: '1' },
      { question: 'b', payload: '2' },
    ];
    expect(removeRow(rows, 0, blankIceBreaker)).toEqual([{ question: 'b', payload: '2' }]);
    expect(removeRow([{ question: 'a', payload: '1' }], 0, blankIceBreaker)).toEqual([
      blankIceBreaker(),
    ]);
  });

  it('patching changes one row only and leaves the original untouched', () => {
    const rows = [blankMenuItem(), blankMenuItem()];
    const next = patchRow(rows, 1, { title: 'Talk', type: 'web_url' as const });
    expect(next[0]).toEqual(blankMenuItem());
    expect(next[1]).toMatchObject({ title: 'Talk', type: 'web_url' });
    expect(rows[1]).toEqual(blankMenuItem());
  });
});

describe('the tabs and previews', () => {
  it('a tab is set when its piece has content', () => {
    expect(tabsSet(view())).toEqual({
      getstarted: false,
      greeting: false,
      menu: false,
      icebreakers: false,
    });
    expect(
      tabsSet(
        view({
          getStarted: 'GET_STARTED',
          menu: { items: [blankMenuItem()], composerInputDisabled: false },
          iceBreakers: [{ question: 'q', payload: 'p' }],
        }),
      ),
    ).toEqual({ getstarted: true, greeting: false, menu: true, icebreakers: true });
  });

  it('the first tab is the first piece set up, else Get Started', () => {
    expect(firstTab(view())).toBe('getstarted');
    expect(firstTab(view({ greeting: 'Hi' }))).toBe('greeting');
    expect(firstTab(view({ iceBreakers: [{ question: 'q', payload: 'p' }] }))).toBe('icebreakers');
  });

  it('a preview lists the saved rows, else the samples, cut to the cap', () => {
    const samples = ['One', 'Two', 'Three', 'Four', 'Five'];
    expect(menuPreviewTitles([], samples)).toEqual(['One', 'Two', 'Three']);
    expect(menuPreviewTitles([{ ...blankMenuItem(), title: 'Mine' }], samples)).toEqual(['Mine']);
    expect(iceBreakerPreview([], samples)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(iceBreakerPreview([{ question: 'Hours?', payload: 'H' }], samples)).toEqual(['Hours?']);
  });
});
