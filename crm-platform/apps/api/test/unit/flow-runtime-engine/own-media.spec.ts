import { describe, expect, it } from 'vitest';
import { readOwnMedia } from '../../../src/modules/flow-runtime-engine/runtime/flow-sender.service';
import type { FlowMediaStore } from '../../../src/infra/providers/flow-builder-editor/flow-media.port';

const NAME = '1761234567_0123456789abcdef01234567.png';
const store = (present: boolean): FlowMediaStore & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    put: async () => ({ url: '' }),
    get: async (org, name) => {
      asked.push(`${org}/${name}`);
      return present ? { data: Buffer.from('png'), mime: 'image/png' } : null;
    },
  };
};

describe('a file the builder uploaded is read from its store', () => {
  it('reads it from the store, whatever host the link names', async () => {
    const s = store(true);
    const got = await readOwnMedia(s, `http://localhost:53000/v2/flow-media/org_1/${NAME}`);
    expect(s.asked).toEqual([`org_1/${NAME}`]);
    expect(got).toMatchObject({ mimetype: 'image/png', extension: '.png' });
    expect(got?.buffer.toString()).toBe('png');
  });

  it('is null for any other link, or when the file is gone (the link is then fetched as usual)', async () => {
    const s = store(true);
    expect(await readOwnMedia(s, 'https://cdn.example.com/a.png')).toBeNull();
    expect(await readOwnMedia(s, 'https://x.test/v2/flow-media/org_1/../../etc/passwd')).toBeNull();
    expect(s.asked).toEqual([]);
    expect(
      await readOwnMedia(store(false), `https://x.test/v2/flow-media/org_1/${NAME}`),
    ).toBeNull();
    expect(await readOwnMedia(undefined, `https://x.test/v2/flow-media/org_1/${NAME}`)).toBeNull();
  });
});
