import { describe, expect, it, vi } from 'vitest';
import { templateMediaPaths } from '../payload/template-vars';
import { SqlTemplateDirectory } from './sql-template-directory';

const directory = (link: (key: string) => Promise<string | null>) => {
  const linker = vi.fn(async () => link);
  const dir = new SqlTemplateDirectory({ linker } as never);
  return { dir, linker };
};

describe('SqlTemplateDirectory.mediaUrls', () => {
  it('keeps an absolute URL and links a stored key (the header file of a test send, row 426)', async () => {
    const { dir } = directory(async (key) => `https://cdn.example.com/${key}?sig=1`);
    const links = await dir.mediaUrls(['https://x.test/a.png', 'templates/1/header.png']);
    expect(links.get('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(links.get('templates/1/header.png')).toBe(
      'https://cdn.example.com/templates/1/header.png?sig=1',
    );
  });

  it('leaves out a key with no public link (local disk) and asks storage once for a repeated key', async () => {
    const none = directory(async () => null);
    expect((await none.dir.mediaUrls(['a.png'])).size).toBe(0);

    const link = vi.fn(async (key: string) => `https://cdn.example.com/${key}`);
    const { dir, linker } = directory(link);
    await dir.mediaUrls(['b.png', 'b.png']);
    await dir.mediaUrls(['b.png']);
    expect(link).toHaveBeenCalledTimes(1);
    expect(linker).toHaveBeenCalledTimes(1);
  });
});

describe('templateMediaPaths', () => {
  it('lists the header file and the carousel card images', () => {
    expect(
      templateMediaPaths({
        headerMediaKey: 'h.png',
        carouselData: [{ image: 'c1.png' }, { image: '' }, { body: 'x' }],
      }),
    ).toEqual(['h.png', 'c1.png']);
    expect(templateMediaPaths({ headerMediaKey: null })).toEqual([]);
  });
});

describe('SqlTemplateDirectory.mediaUrls cache and ttl', () => {
  it('remembers a key with no link, so a run does not ask storage for every recipient', async () => {
    const { dir, linker } = directory(async () => null);
    await dir.mediaUrls(['gone.png']);
    await dir.mediaUrls(['gone.png']);
    expect(linker).toHaveBeenCalledTimes(1);
  });

  it('asks storage for the requested lifetime and keeps lifetimes apart', async () => {
    const { dir, linker } = directory(async (key) => `https://cdn.example.com/${key}`);
    await dir.mediaUrls(['p.png'], 3600);
    await dir.mediaUrls(['p.png']);
    expect(linker.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([3600, 86400]);
  });
});
