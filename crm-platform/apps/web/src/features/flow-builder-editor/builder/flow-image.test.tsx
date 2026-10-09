// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { imageLinkProblem } from './flow-image';

describe('imageLinkProblem', () => {
  it('names why a link cannot be an image, and passes the ones a browser can load', () => {
    expect(imageLinkProblem('')).toBe('the link is empty');
    expect(imageLinkProblem('www.example.com/a.png')).toContain('not a web address');
    expect(imageLinkProblem('ftp://x/a.png')).toContain('not a web address');
    expect(imageLinkProblem('https://assets.example.com/a.png')).toBeNull();
    expect(imageLinkProblem('/a.png')).toBeNull();
    expect(imageLinkProblem('data:image/png;base64,AAAA')).toBeNull();
  });
});
