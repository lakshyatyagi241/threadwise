import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  QUALITY_STEPS,
  encodePlan,
  fitWithin,
  isAvatarType,
} from './image-downscale';

describe('fitWithin', () => {
  it('scales the longest edge down to 512 keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 512, height: 384 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 384, height: 512 });
    expect(fitWithin(1024, 1024)).toEqual({ width: 512, height: 512 });
  });

  it('never upscales a small picture', () => {
    expect(fitWithin(200, 120)).toEqual({ width: 200, height: 120 });
    expect(fitWithin(512, 512)).toEqual({ width: 512, height: 512 });
  });

  it('never returns a zero edge for extreme ratios', () => {
    expect(fitWithin(20000, 10)).toEqual({ width: 512, height: 1 });
  });

  it('survives zero or invalid sizes', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(Number.NaN, 5)).toEqual({ width: 1, height: 1 });
  });

  it('honours a custom limit', () => {
    expect(fitWithin(1000, 500, 256)).toEqual({ width: 256, height: 128 });
  });
});

describe('encodePlan', () => {
  it('starts at the fitted size with the best quality', () => {
    const plan = encodePlan(4000, 3000);
    expect(plan[0]).toEqual({ width: 512, height: 384, quality: QUALITY_STEPS[0] });
  });

  it('steps quality down before it shrinks the picture', () => {
    const plan = encodePlan(2000, 2000);
    expect(plan.slice(0, QUALITY_STEPS.length).map((a) => a.quality)).toEqual([...QUALITY_STEPS]);
    expect(new Set(plan.slice(0, QUALITY_STEPS.length).map((a) => a.width))).toEqual(
      new Set([512]),
    );
    expect(plan[QUALITY_STEPS.length]!.width).toBeLessThan(512);
  });

  it('keeps every attempt within the limit and stops above a sensible floor', () => {
    const plan = encodePlan(5000, 5000);
    expect(Math.max(...plan.map((a) => Math.max(a.width, a.height)))).toBeLessThanOrEqual(512);
    expect(Math.min(...plan.map((a) => Math.min(a.width, a.height)))).toBeGreaterThanOrEqual(90);
    expect(plan.length).toBeLessThanOrEqual(QUALITY_STEPS.length * 4);
  });

  it('a tiny picture still gets a plan', () => {
    const plan = encodePlan(64, 64);
    expect(plan.length).toBe(QUALITY_STEPS.length);
    expect(plan[0]).toMatchObject({ width: 64, height: 64 });
  });
});

describe('limits', () => {
  it('stays under the 1 MiB the API accepts', () => {
    expect(AVATAR_MAX_BYTES).toBeLessThan(1024 * 1024);
  });
  it('accepts exactly the formats the API accepts', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
      expect(isAvatarType(t)).toBe(true);
    for (const t of ['image/svg+xml', 'image/bmp', 'application/pdf', ''])
      expect(isAvatarType(t)).toBe(false);
  });
});
