import { describe, expect, it } from 'vitest';
import { isInternalHost, publicApiOrigin } from './public-api-origin';

describe('publicApiOrigin', () => {
  it('prefers the configured public address', () => {
    expect(
      publicApiOrigin({
        PUBLIC_API_URL: 'https://api.example.com',
        APP_URL: 'https://app.example.com',
        API_URL: 'http://desk-api-blue:3000',
      }),
    ).toBe('https://api.example.com');
  });
  it('falls back to the app address', () => {
    expect(publicApiOrigin({ APP_URL: 'https://desk.example.com', API_URL: 'http://x:3000' })).toBe(
      'https://desk.example.com',
    );
  });
  it('never returns a container service name', () => {
    expect(publicApiOrigin({ API_URL: 'http://desk-api-blue:3000' })).toBe('http://localhost:3000');
  });
  it('keeps a public proxy target and local development', () => {
    expect(publicApiOrigin({ API_URL: 'https://api.example.com' })).toBe('https://api.example.com');
    expect(publicApiOrigin({ API_URL: 'http://localhost:4000' })).toBe('http://localhost:4000');
    expect(publicApiOrigin({})).toBe('http://localhost:3000');
  });
  it('knows an internal host', () => {
    expect(isInternalHost('http://desk-api-green:3000')).toBe(true);
    expect(isInternalHost('http://api.svc.cluster.local')).toBe(true);
    expect(isInternalHost('http://not a url')).toBe(true);
    expect(isInternalHost('https://desk.example.com')).toBe(false);
  });
});
