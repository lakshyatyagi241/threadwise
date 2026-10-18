import { describe, expect, it, vi } from 'vitest';
import { FormSubmitService } from '../../../src/modules/forms-builder/form-submit.service';

/**
 * A public form submission tags the new contact (`applyTags`). It used to look each tag up on its own, count the workspace's tags for every
 * new one, and attach one tag at a time (QA task 43). It now reads the existing tags once, looks up the plan's cap at most once and only when a
 * tag has to be made, and attaches everything in one call. This drives the real method with stubbed collaborators and checks the query
 * counts AND that the rules are unchanged: a tag past the cap is skipped (the submission is never refused over a label), a lost race
 * takes the winner, repeats attach once.
 */
type Tag = { id: number; name: string };

function harness(opts: { existing?: Tag[]; cap?: number; total?: number; raceWinner?: Tag[] }) {
  const store = new Map<string, Tag>((opts.existing ?? []).map((t) => [t.name.toLowerCase(), t]));
  let nextId = 500;
  let total = opts.total ?? store.size;
  const findByNames = vi.fn(async (_tx: unknown, _org: number, names: readonly string[]) => {
    const out = new Map<string, Tag>();
    for (const n of names) {
      const t = store.get(n.trim().toLowerCase());
      if (t) out.set(n.trim().toLowerCase(), t);
    }
    return out;
  });
  const insertIfAbsent = vi.fn(async (_tx: unknown, _org: number, row: { name: string }) => {
    const winner = opts.raceWinner?.find((t) => t.name.toLowerCase() === row.name.toLowerCase());
    if (winner) {
      store.set(winner.name.toLowerCase(), winner); // someone else made it first: no row of ours
      return undefined;
    }
    const made = { id: nextId++, name: row.name };
    store.set(row.name.toLowerCase(), made);
    total += 1;
    return made;
  });
  const countAll = vi.fn(async () => total);
  const attach = vi.fn(async () => []);
  const limit = vi.fn(async () => opts.cap ?? 0);
  const service = Object.create(FormSubmitService.prototype) as FormSubmitService;
  Object.assign(service, {
    tags: { findByNames, insertIfAbsent, countAll, attach },
    entitlements: { limit },
  });
  const run = (names: string[]) =>
    (
      service as unknown as {
        applyTags: (
          tx: unknown,
          org: number,
          contact: number,
          names: readonly string[],
        ) => Promise<void>;
      }
    ).applyTags({}, 7, 42, names);
  return { run, findByNames, insertIfAbsent, countAll, attach, limit };
}

describe('form submission tags', () => {
  it('three tags that already exist cost one read and one attach', async () => {
    const h = harness({
      existing: [
        { id: 1, name: 'VIP' },
        { id: 2, name: 'Lead' },
        { id: 3, name: 'Web' },
      ],
    });
    await h.run(['vip', 'LEAD', 'Web']);
    expect(h.findByNames).toHaveBeenCalledTimes(1);
    expect(h.insertIfAbsent).not.toHaveBeenCalled();
    expect(h.countAll).not.toHaveBeenCalled();
    expect(h.limit).not.toHaveBeenCalled();
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect(h.attach).toHaveBeenCalledWith({}, 7, [42], [1, 2, 3], null);
  });

  it('new tags are created, the plan cap is looked up once, and nothing is counted when the plan has no cap', async () => {
    const h = harness({ cap: 0 });
    await h.run(['a', 'b', 'c']);
    expect(h.insertIfAbsent).toHaveBeenCalledTimes(3);
    expect(h.limit).toHaveBeenCalledTimes(1);
    expect(h.countAll).not.toHaveBeenCalled();
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect((h.attach.mock.calls[0] as unknown[])[3]).toHaveLength(3);
  });

  it('counts the workspace tags once, and stops making tags when the cap is reached', async () => {
    const h = harness({ cap: 3, total: 2 });
    await h.run(['one', 'two', 'three']);
    expect(h.countAll).toHaveBeenCalledTimes(1); // once, not per new tag
    expect(h.insertIfAbsent).toHaveBeenCalledTimes(1); // the first fills the cap; the others are skipped, not refused
    expect((h.attach.mock.calls[0] as unknown[])[3]).toHaveLength(1);
  });

  it('a workspace already at its cap still tags with the tags that exist, and makes none', async () => {
    const h = harness({ existing: [{ id: 9, name: 'Known' }], cap: 1, total: 1 });
    await h.run(['known', 'unknown']);
    expect(h.insertIfAbsent).not.toHaveBeenCalled();
    expect(h.attach).toHaveBeenCalledWith({}, 7, [42], [9], null);
  });

  it('a tag another request made at the same moment is taken as the answer', async () => {
    const h = harness({ raceWinner: [{ id: 77, name: 'Raced' }] });
    await h.run(['raced']);
    expect(h.attach).toHaveBeenCalledWith({}, 7, [42], [77], null);
  });

  it('the same tag twice, in any case, is attached once', async () => {
    const h = harness({ existing: [{ id: 5, name: 'Dup' }] });
    await h.run(['dup', 'DUP', ' Dup ']);
    expect(h.attach).toHaveBeenCalledWith({}, 7, [42], [5], null);
  });

  it('no tags, or only blanks, attaches nothing', async () => {
    const h = harness({});
    await h.run([]);
    await h.run(['', '   ']);
    expect(h.attach).not.toHaveBeenCalled();
  });
});
