import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { needsCopy, SaveCopy } from './picture-copy';

// Messages are not loaded here: the key is the text, so the rendered markup names the keys.
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = t;
    return t;
  },
}));

const noop = () => undefined;

describe('needsCopy: which picture addresses the builder offers to copy', () => {
  it('offers a copy for a web address outside our own media store', () => {
    expect(needsCopy('https://photos.example.com/IMG_1234.JPG')).toBe(true);
    expect(needsCopy('  http://cdn.example.com/a.jpeg ')).toBe(true);
  });

  it('does not offer a copy for our own copy, an empty field, or a non-web address', () => {
    expect(
      needsCopy(
        'https://app.example.com/v2/flow-media/org/1700000000_abcdef0123456789abcdef01.jpg',
      ),
    ).toBe(false);
    expect(needsCopy('')).toBe(false);
    expect(needsCopy('javascript:alert(1)')).toBe(false);
    expect(needsCopy('/relative/a.jpg')).toBe(false);
  });
});

describe('SaveCopy', () => {
  it('shows the copy control with its hint, not busy', () => {
    const html = renderToStaticMarkup(
      <SaveCopy url="https://photos.example.com/a.jpg" onSaved={noop} onFailed={noop} />,
    );
    expect(html).toContain('saveCopy');
    expect(html).toContain('saveCopyHint');
    expect(html).toContain('<button');
    expect(html).not.toContain(' disabled=""');
  });
});
