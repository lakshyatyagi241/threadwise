import { describe, expect, it } from 'vitest';
import { describeSegments } from './segment-model';

describe('the segment counter', () => {
  it('has no warning for a one-segment text', () => {
    const v = describeSegments('a'.repeat(160));
    expect(v).toMatchObject({
      segments: 1,
      encoding: 'GSM-7',
      units: 160,
      remaining: 0,
      warning: 'none',
    });
  });

  it('warns about billing once a GSM-7 text needs a second segment', () => {
    const v = describeSegments('a'.repeat(161));
    expect(v).toMatchObject({ segments: 2, perSegment: 153, remaining: 145, warning: 'gsm' });
  });

  it('warns about the alphabet when an emoji forces UCS-2', () => {
    expect(describeSegments('Hello 😀')).toMatchObject({
      encoding: 'UCS-2',
      segments: 1,
      perSegment: 70,
      warning: 'none',
    });
    expect(describeSegments('é'.repeat(30) + '😀'.repeat(21))).toMatchObject({
      encoding: 'UCS-2',
      segments: 2,
      warning: 'ucs2',
    });
  });

  it('counts an empty text as one segment', () => {
    expect(describeSegments('')).toMatchObject({ segments: 1, remaining: 160, warning: 'none' });
  });
});
