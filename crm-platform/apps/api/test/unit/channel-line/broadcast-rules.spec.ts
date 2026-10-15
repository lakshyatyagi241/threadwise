import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE,
  isUnreachable,
  mediaKindFor,
  personalise,
  progressPct,
} from '../../../src/modules/channel-line/broadcast-rules';

describe('batch', () => {
  it("is Reference's 40 people per batch", () => {
    expect(BATCH_SIZE).toBe(40);
  });
});

describe('isUnreachable', () => {
  it('reads a block or a gone friend as unreachable', () => {
    expect(isUnreachable('The user has blocked the account')).toBe(true);
    expect(isUnreachable('Failed to send messages: not a friend')).toBe(true);
    expect(isUnreachable('Invalid user ID')).toBe(true);
    expect(isUnreachable('Forbidden')).toBe(true);
    expect(isUnreachable('User not found')).toBe(true);
  });

  it('keeps a quota, a rate limit or a server fault retryable', () => {
    expect(isUnreachable('You have reached your monthly limit.')).toBe(false);
    expect(isUnreachable('Too many requests')).toBe(false);
    expect(isUnreachable('The request timed out')).toBe(false);
  });
});

describe('personalise', () => {
  it('fills every spelling of the name placeholder and trims', () => {
    expect(personalise(' Hi {{name}}, {{ name }} and {name} ', 'Asha')).toBe(
      'Hi Asha, Asha and Asha',
    );
    expect(personalise('Hi {{name}}', null)).toBe('Hi');
  });
});

describe('progressPct', () => {
  it('counts blocked as done and survives an empty broadcast', () => {
    expect(progressPct(5, 2, 3, 20)).toBe(50);
    expect(progressPct(0, 0, 0, 0)).toBe(0);
    expect(progressPct(10, 0, 0, 10)).toBe(100);
  });
});

describe('mediaKindFor', () => {
  it('maps the extension the way Reference does, anything else is an image', () => {
    expect(mediaKindFor('https://x/a.MP4?sig=1')).toBe('video');
    expect(mediaKindFor('https://x/a.mov')).toBe('video');
    expect(mediaKindFor('https://x/a.mp3')).toBe('audio');
    expect(mediaKindFor('https://x/a.m4a')).toBe('audio');
    expect(mediaKindFor('https://x/a.png')).toBe('image');
    expect(mediaKindFor('https://x/a.pdf')).toBe('image');
    expect(mediaKindFor('not a url.mp4')).toBe('video');
  });
});
