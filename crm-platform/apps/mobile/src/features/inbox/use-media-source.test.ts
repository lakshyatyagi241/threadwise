import { mediaUri } from './use-media-source';

describe('mediaUri', () => {
  it('turns the web app proxy link into an address on the API', () => {
    expect(mediaUri('/api/v2/media/abc', 'http://api.test')).toBe('http://api.test/v2/media/abc');
    expect(mediaUri('/api/v2/media/abc', 'http://api.test/')).toBe('http://api.test/v2/media/abc');
  });

  it('leaves a link that is already on the API, and a full address, as it is', () => {
    expect(mediaUri('/v2/media/abc', 'http://api.test')).toBe('http://api.test/v2/media/abc');
    expect(mediaUri('https://cdn.test/a.png', 'http://api.test')).toBe('https://cdn.test/a.png');
  });
});
