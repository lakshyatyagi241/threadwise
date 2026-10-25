// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { imageLinkProblem } from './flow-image';

describe('imageLinkProblem', () => {
  it('names why a link cannot be an image, and passes the ones a browser can load', () => {
    expect(imageLinkProblem('')).toBe('empty');
    expect(imageLinkProblem('www.example.com/a.png')).toBe('notAddress');
    expect(imageLinkProblem('ftp://x/a.png')).toBe('notAddress');
    expect(imageLinkProblem('https://assets.example.com/a.png')).toBeNull();
    expect(imageLinkProblem('/a.png')).toBeNull();
    expect(imageLinkProblem('data:image/png;base64,AAAA')).toBeNull();
  });
});
