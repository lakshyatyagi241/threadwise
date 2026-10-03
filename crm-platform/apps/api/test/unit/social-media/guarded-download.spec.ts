import { describe, expect, it } from 'vitest';
import { downloadSocialMedia } from '../../../src/infra/providers/social-media/guarded-download';

describe('downloadSocialMedia', () => {
  it.each([
    ['a host that is not Meta’s', 'https://evil.example.com/a.jpg'],
    ['plain http', 'http://lookaside.fbsbx.com/a.jpg'],
    ['an ip address', 'https://169.254.169.254/latest/meta-data'],
    ['credentials in the address', 'https://user:pw@scontent.fbcdn.net/a.jpg'],
    ['not an address', 'not a url'],
  ])('refuses %s before any connection is made', async (_why, url) => {
    await expect(downloadSocialMedia(url)).rejects.toMatchObject({
      name: 'SocialMediaDownloadError',
    });
  });
});
