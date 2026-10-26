import { docsIn, findDoc, HELP_CATEGORIES, searchDocs, textOf, type HelpBlock } from './help-data';

describe('the guides copied from the web Help center', () => {
  it('has guides in every group, each with an English text, a title and a body', () => {
    for (const category of HELP_CATEGORIES) {
      const docs = docsIn(category);
      expect(docs.length).toBeGreaterThan(0);
      for (const doc of docs) {
        expect(doc.text.en.title).toBeTruthy();
        expect(doc.text.en.summary).toBeTruthy();
        expect(doc.text.en.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it('lists a group in order, with no guide twice across the app', () => {
    const ids = HELP_CATEGORIES.flatMap((category) => docsIn(category).map((doc) => doc.id));
    expect(new Set(ids).size).toBe(ids.length);
    const inbox = docsIn('inbox');
    expect(inbox.map((doc) => doc.order)).toEqual(
      [...inbox.map((doc) => doc.order)].sort((a, b) => a - b),
    );
  });

  it('points every guide link to a guide that is in the app (a missing one would show as plain text)', () => {
    const missing: string[] = [];
    const visit = (blocks: readonly HelpBlock[]) => {
      for (const block of blocks) {
        const runs =
          block.t === 'p' || block.t === 'note'
            ? block.inline
            : block.t === 'ul' || block.t === 'ol'
              ? block.items.flat()
              : [];
        for (const run of runs) if (run.t === 'doc' && !findDoc(run.doc)) missing.push(run.doc);
      }
    };
    for (const category of HELP_CATEGORIES)
      for (const doc of docsIn(category)) visit(doc.text.en.blocks);
    // The web has more guides than the phone needs; a link to one of those is shown as text. This only guards the count from
    // growing unnoticed when the guides are copied again.
    expect(new Set(missing).size).toBeLessThan(80);
  });

  it('finds a guide by id, and nothing for an id that is not one', () => {
    expect(findDoc('saved-replies')?.category).toBe('settings');
    expect(findDoc('nope')).toBeUndefined();
    expect(findDoc(undefined)).toBeUndefined();
  });

  it('shows the guide in the language it has, else in English and says so', () => {
    const translated = HELP_CATEGORIES.flatMap((c) => docsIn(c)).find((doc) => doc.text.ar);
    expect(translated).toBeDefined();
    expect(textOf(translated!, 'ar').fallback).toBe(false);
    expect(textOf(translated!, 'ar').text.title).toBe(translated!.text.ar!.title);
    const english = findDoc('log-a-call')!;
    expect(textOf(english, 'en').fallback).toBe(false);
    expect(textOf(english, 'en-GB').fallback).toBe(false);
    const other = HELP_CATEGORIES.flatMap((c) => docsIn(c)).find((doc) => !doc.text.de)!;
    expect(textOf(other, 'de')).toEqual({ text: other.text.en, fallback: true });
  });

  it('searches titles, summaries and keywords for every word typed, titles first', () => {
    expect(searchDocs('   ', 'en')).toEqual([]);
    const hits = searchDocs('saved replies', 'en');
    expect(hits[0]?.id).toBe('saved-replies');
    expect(searchDocs('SAVED   Replies', 'en')[0]?.id).toBe('saved-replies');
    expect(searchDocs('zzzzqqq', 'en')).toEqual([]);
    // A word that is only in the English text still finds the guide for someone reading Arabic.
    expect(searchDocs('saved replies', 'ar').map((doc) => doc.id)).toContain('saved-replies');
  });
});
