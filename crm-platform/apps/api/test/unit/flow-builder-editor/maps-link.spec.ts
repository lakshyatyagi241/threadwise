import { describe, expect, it } from 'vitest';
import {
  MapsLinkService,
  type HopFetcher,
} from '../../../src/modules/flow-builder-editor/maps-link.service';

/** The Location step's link resolver: a long link needs no network, a short one is followed hop by hop, Google hosts only. */

const service = (script: Record<string, { status: number; location: string | null }>) => {
  const svc = new MapsLinkService();
  const asked: string[] = [];
  const hop: HopFetcher = async (url) => {
    asked.push(url.toString());
    const r = script[url.toString()];
    if (!r) throw new Error('unexpected request to ' + url.toString());
    return r;
  };
  svc.hop = hop;
  return { svc, asked };
};

describe('MapsLinkService', () => {
  it('reads a long link without any request', async () => {
    const { svc, asked } = service({});
    expect(await svc.resolve('https://www.google.com/maps/@18.5204,73.8567,15z')).toEqual({
      ok: true,
      lat: 18.5204,
      lng: 73.8567,
    });
    expect(asked).toEqual([]);
  });

  it('follows a short link to the long one', async () => {
    const { svc, asked } = service({
      'https://maps.app.goo.gl/AbC123': {
        status: 302,
        location:
          'https://www.google.com/maps/place/Cafe/@48.85,2.29,17z/data=!3m1!4b1!8m2!3d48.8583701!4d2.2944813',
      },
    });
    expect(await svc.resolve('maps.app.goo.gl/AbC123')).toEqual({
      ok: true,
      lat: 48.8583701,
      lng: 2.2944813,
    });
    expect(asked).toEqual(['https://maps.app.goo.gl/AbC123']);
  });

  it('follows a chain of short links and a consent redirect, with a relative Location', async () => {
    const { svc } = service({
      'https://maps.app.goo.gl/a': { status: 301, location: 'https://goo.gl/maps/b' },
      'https://goo.gl/maps/b': {
        status: 302,
        location:
          'https://consent.google.com/m?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2F%4010.5%2C20.5%2C12z',
      },
    });
    expect(await svc.resolve('https://maps.app.goo.gl/a')).toEqual({
      ok: true,
      lat: 10.5,
      lng: 20.5,
    });
  });

  it('never requests a host that is not Google, even when a short link redirects there', async () => {
    const { svc, asked } = service({
      'https://maps.app.goo.gl/evil': {
        status: 302,
        location: 'https://169.254.169.254/latest/meta-data',
      },
      'https://maps.app.goo.gl/evil2': {
        status: 302,
        location: 'https://attacker.test/maps/@1,2,3z',
      },
      'https://maps.app.goo.gl/http': {
        status: 302,
        location: 'http://www.google.com/maps/@1,2,3z',
      },
    });
    for (const code of ['evil', 'evil2', 'http'])
      expect(await svc.resolve(`https://maps.app.goo.gl/${code}`), code).toEqual({
        ok: false,
        problem: 'resolve_failed',
      });
    expect(asked.every((u) => u.startsWith('https://maps.app.goo.gl/'))).toBe(true);
  });

  it('refuses pasted links that are not Google Maps without any request', async () => {
    const { svc, asked } = service({});
    expect(await svc.resolve('http://127.0.0.1:8080/maps')).toEqual({
      ok: false,
      problem: 'not_maps',
    });
    expect(await svc.resolve('https://example.com/x')).toEqual({ ok: false, problem: 'not_maps' });
    expect(await svc.resolve('not a link')).toEqual({ ok: false, problem: 'not_url' });
    expect(asked).toEqual([]);
  });

  it('does not follow a short link on another port or over plain http', async () => {
    const { svc, asked } = service({});
    expect(await svc.resolve('https://maps.app.goo.gl:8443/x')).toEqual({
      ok: false,
      problem: 'resolve_failed',
    });
    expect(await svc.resolve('http://maps.app.goo.gl/x')).toEqual({
      ok: false,
      problem: 'resolve_failed',
    });
    expect(asked).toEqual([]);
  });

  it('stops after 5 hops', async () => {
    const loop = { status: 302, location: 'https://maps.app.goo.gl/loop' };
    const { svc, asked } = service({ 'https://maps.app.goo.gl/loop': loop });
    expect(await svc.resolve('https://maps.app.goo.gl/loop')).toEqual({
      ok: false,
      problem: 'resolve_failed',
    });
    expect(asked).toHaveLength(5);
  });

  it('fails softly: no redirect, a network error, or a destination with no pin', async () => {
    expect(
      await service({ 'https://maps.app.goo.gl/x': { status: 200, location: null } }).svc.resolve(
        'https://maps.app.goo.gl/x',
      ),
    ).toEqual({ ok: false, problem: 'resolve_failed' });
    expect(await service({}).svc.resolve('https://maps.app.goo.gl/boom')).toEqual({
      ok: false,
      problem: 'resolve_failed',
    });
    expect(
      await service({
        'https://maps.app.goo.gl/s': {
          status: 302,
          location: 'https://www.google.com/maps/search/pizza',
        },
      }).svc.resolve('https://maps.app.goo.gl/s'),
    ).toEqual({ ok: false, problem: 'no_coords' });
  });

  it('refuses coordinates out of range or 0,0 in the resolved link', async () => {
    const { svc } = service({
      'https://maps.app.goo.gl/z': { status: 302, location: 'https://www.google.com/maps?q=0,0' },
    });
    expect(await svc.resolve('https://maps.app.goo.gl/z')).toEqual({ ok: false, problem: 'zero' });
  });
});
