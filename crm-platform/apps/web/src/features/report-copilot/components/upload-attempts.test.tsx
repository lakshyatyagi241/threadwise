import { describe, expect, it } from 'vitest';
import type { Attempt } from '../lib/upload-queue';
import { UploadAttempts } from './upload-attempts';
import { html } from './test-utils';

const at = (over: Partial<Attempt>): Attempt => ({
  key: 'k',
  name: 'plan.pdf',
  status: 'busy',
  ...over,
});
const render = (attempts: Attempt[], showDone = false) =>
  html(
    <UploadAttempts
      attempts={attempts}
      scope="workspace"
      onDismiss={() => undefined}
      showDone={showDone}
    />,
  );

describe('UploadAttempts', () => {
  it('says what is uploading', () => {
    expect(render([at({})])).toContain('Reading plan.pdf…');
  });

  it('says a file was added and invites a question, in the chat (showDone) but not in the library', () => {
    const done = at({ status: 'done' });
    expect(render([done], true)).toContain('Added plan.pdf. Ask me about it.');
    expect(render([done], false)).toBe('');
  });

  it('gives each failure the same words the library uses', () => {
    const failed = (error: Attempt['error'], extra: Partial<Attempt> = {}) =>
      render([at({ status: 'failed', error, ...extra })]);
    expect(failed('tooBig')).toContain('plan.pdf is larger than 10 MB.');
    expect(failed('badType')).toContain('plan.pdf is not a file type the assistant can read.');
    expect(failed('full')).toContain('The library is full');
    expect(failed('unreadable', { detail: 'No readable text found.' })).toContain(
      'plan.pdf: No readable text found.',
    );
    expect(failed('network')).toContain('did not reach the server');
  });

  it('links a missing AI key to the AI keys screen', () => {
    const out = render([at({ status: 'failed', error: 'keyRequired' })]);
    expect(out).toContain('Add an AI key in Settings');
    expect(out).toContain('href="/ai-keys"');
  });

  it('shows nothing when there is nothing to show', () => {
    expect(render([])).toBe('');
  });
});
