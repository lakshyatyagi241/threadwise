import { describe, expect, it } from 'vitest';
import { ERROR_CODES, REPORT_DOCUMENT_EXTENSIONS, REPORT_DOCUMENT_LIMITS } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { runUploads, upsertAttempt, type Attempt } from './upload-queue';

const file = (name: string, size = 10) => ({ name, size }) as File;

function run(
  files: File[],
  over: {
    existing?: number;
    max?: number;
    upload?: (f: File) => Promise<unknown>;
  } = {},
) {
  const events: Attempt[] = [];
  const calls: string[] = [];
  let n = 0;
  const done = runUploads({
    files,
    existing: over.existing ?? 0,
    max: over.max ?? REPORT_DOCUMENT_LIMITS.maxDocuments,
    extensions: REPORT_DOCUMENT_EXTENSIONS,
    maxBytes: REPORT_DOCUMENT_LIMITS.fileBytes,
    upload:
      over.upload ??
      (async (f) => {
        calls.push(f.name);
      }),
    onChange: (a) => events.push(a),
    newKey: () => `k${n++}`,
  });
  return { done, events, calls };
}
const last = (events: Attempt[], key: string) => events.filter((e) => e.key === key).at(-1)!;

describe('runUploads', () => {
  it('uploads accepted files one after another and reports busy then done for each', async () => {
    const order: string[] = [];
    const { done, events } = run([file('a.pdf'), file('b.docx')], {
      upload: async (f) => {
        order.push(`start ${f.name}`);
        await Promise.resolve();
        order.push(`end ${f.name}`);
      },
    });
    expect(await done).toBe(2);
    expect(order).toEqual(['start a.pdf', 'end a.pdf', 'start b.docx', 'end b.docx']);
    expect(events.map((e) => `${e.name}:${e.status}`)).toEqual([
      'a.pdf:busy',
      'a.pdf:done',
      'b.docx:busy',
      'b.docx:done',
    ]);
  });

  it('accepts every extension the library lists, in any case', async () => {
    const names = REPORT_DOCUMENT_EXTENSIONS.map((e, i) => `f${i}.${i % 2 ? e.toUpperCase() : e}`);
    const { done, calls } = run(
      names.map((n) => file(n)),
      { max: 100 },
    );
    expect(await done).toBe(names.length);
    expect(calls).toEqual(names);
  });

  it('refuses a wrong type or a file over 10 MB before sending it, and goes on to the next file', async () => {
    const { done, events, calls } = run([
      file('virus.exe'),
      file('huge.pdf', REPORT_DOCUMENT_LIMITS.fileBytes + 1),
      file('legacy.doc'),
      file('ok.txt'),
    ]);
    expect(await done).toBe(1);
    expect(calls).toEqual(['ok.txt']);
    expect(last(events, 'k0')).toMatchObject({ status: 'failed', error: 'badType' });
    expect(last(events, 'k1')).toMatchObject({ status: 'failed', error: 'tooBig' });
    expect(last(events, 'k2')).toMatchObject({ status: 'failed', error: 'badType' });
    expect(last(events, 'k3')).toMatchObject({ status: 'done' });
  });

  it('takes a file of exactly 10 MB', async () => {
    const { done } = run([file('edge.pdf', REPORT_DOCUMENT_LIMITS.fileBytes)]);
    expect(await done).toBe(1);
  });

  it('stops adding when the library is full, counting the files it has just added', async () => {
    const { done, events, calls } = run([file('a.txt'), file('b.txt'), file('c.txt')], {
      existing: 23,
      max: 25,
    });
    expect(await done).toBe(2);
    expect(calls).toEqual(['a.txt', 'b.txt']);
    expect(last(events, 'k2')).toMatchObject({ status: 'failed', error: 'full' });
  });

  it('keeps the server code and reason when it refuses a file, and still tries the rest', async () => {
    const tried: string[] = [];
    const { done, events } = run([file('scan.pdf'), file('b.txt')], {
      upload: async (f) => {
        tried.push(f.name);
        if (f.name === 'scan.pdf')
          throw new ApiError(422, ERROR_CODES.REPORT_DOC_NO_TEXT, 'No readable text found.');
      },
    });
    expect(await done).toBe(1);
    expect(last(events, 'k0')).toMatchObject({
      status: 'failed',
      error: 'unreadable',
      detail: 'No readable text found.',
    });
    expect(last(events, 'k1').status).toBe('done');
    expect(tried).toEqual(['scan.pdf', 'b.txt']);
  });

  it('reports a missing AI key and a dropped connection by kind', async () => {
    const key = run([file('a.pdf')], {
      upload: async () => {
        throw new ApiError(422, ERROR_CODES.REPORT_AI_KEY_MISSING, 'x');
      },
    });
    await key.done;
    expect(last(key.events, 'k0').error).toBe('keyRequired');
    const net = run([file('a.pdf')], {
      upload: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await net.done;
    expect(last(net.events, 'k0').error).toBe('network');
  });

  it('does nothing for no files', async () => {
    const { done, events } = run([]);
    expect(await done).toBe(0);
    expect(events).toEqual([]);
  });
});

describe('upsertAttempt', () => {
  it('replaces the attempt with the same key in place and appends a new one', () => {
    const a: Attempt = { key: '1', name: 'a', status: 'busy' };
    const b: Attempt = { key: '2', name: 'b', status: 'busy' };
    const list = upsertAttempt(upsertAttempt([], a), b);
    const next = upsertAttempt(list, { ...a, status: 'done' });
    expect(next.map((x) => `${x.key}:${x.status}`)).toEqual(['1:done', '2:busy']);
    expect(list[0]!.status).toBe('busy');
  });
});
