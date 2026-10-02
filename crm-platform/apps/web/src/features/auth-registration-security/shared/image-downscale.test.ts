import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  QUALITY_STEPS,
  avatarTargetBytes,
  canUploadAsPicked,
  encodePlan,
  fitWithin,
  formatLimit,
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

describe('canUploadAsPicked', () => {
  const gif = (size: number) => ({ type: 'image/gif', size });

  it('keeps a small GIF as picked so its animation survives', () => {
    expect(canUploadAsPicked(gif(200_000), 320, 240)).toBe(true);
    expect(canUploadAsPicked(gif(AVATAR_MAX_BYTES), 512, 512)).toBe(true);
  });

  it('re-encodes a GIF that is over the byte cap or larger than the circle needs', () => {
    expect(canUploadAsPicked(gif(AVATAR_MAX_BYTES + 1), 320, 240)).toBe(false);
    expect(canUploadAsPicked(gif(100_000), 513, 200)).toBe(false);
  });

  it('always re-encodes other formats, even tiny ones', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp'])
      expect(canUploadAsPicked({ type, size: 1000 }, 64, 64)).toBe(false);
  });
});

describe('avatarTargetBytes', () => {
  it('aims a tenth under the cap the server reported', () => {
    expect(avatarTargetBytes(1024 * 1024)).toBe(943718);
    expect(avatarTargetBytes(512 * 1024)).toBe(471859);
  });
  it('falls back to the built-in target when the server said nothing', () => {
    expect(avatarTargetBytes(undefined)).toBe(AVATAR_MAX_BYTES);
    expect(avatarTargetBytes(null)).toBe(AVATAR_MAX_BYTES);
    expect(avatarTargetBytes(0)).toBe(AVATAR_MAX_BYTES);
  });
});

describe('formatLimit', () => {
  it('writes the cap in megabytes', () => {
    expect(formatLimit(1024 * 1024, 'en')).toMatch(/^1\s?MB$/);
    expect(formatLimit(2.5 * 1024 * 1024, 'en')).toMatch(/^2\.5\s?MB$/);
  });
});

describe('canUploadAsPicked with a server cap', () => {
  it('uses the given cap instead of the built-in one', () => {
    const gif = { type: 'image/gif', size: 600_000 };
    expect(canUploadAsPicked(gif, 200, 200)).toBe(true);
    expect(canUploadAsPicked(gif, 200, 200, 500_000)).toBe(false);
  });
});
