import { describe, expect, it } from 'vitest';
import {
  AUTH_TEMPLATE_MESSAGE,
  mediaUrlProblem,
  templateRefusals,
  type TemplateFacts,
} from '../../../src/modules/broadcasts/template-guards';

const base: TemplateFacts = {
  templateType: 'standard',
  attachmentType: null,
  mediaUrl: null,
  metaTemplateId: null,
  metaStatus: null,
  pausedUntil: null,
  qualityScore: null,
};

describe('mediaUrlProblem (TW-BCAST-012)', () => {
  it('accepts an https public host', () => {
    expect(mediaUrlProblem('https://cdn.example.com/a.png')).toBeNull();
    expect(mediaUrlProblem('https://8.8.8.8/a.png')).toBeNull();
  });

  it.each([
    ['http://cdn.example.com/a.png', /HTTPS/],
    ['https://localhost/a.png', /localhost/],
    ['https://shop.test/a.png', /\.test/],
    ['https://box.local/a.png', /\.local/],
    ['https://svc.internal/a.png', /\.internal/],
    ['https://10.0.0.5/a.png', /private/],
    ['https://172.20.1.1/a.png', /private/],
    ['https://192.168.1.9/a.png', /private/],
    ['https://127.0.0.1/a.png', /private/],
    ['https://[::1]/a.png', /private/],
    ['not a url', /invalid/],
  ])('refuses %s', (url, why) => {
    expect(mediaUrlProblem(url)).toMatch(why);
  });
});

describe('templateRefusals (TW-BCAST-012)', () => {
  it('refuses an authentication template and nothing else', () => {
    expect(templateRefusals({ ...base, templateType: 'auth' }, { wabaTemplatesV2: true })).toEqual([
      AUTH_TEMPLATE_MESSAGE,
    ]);
  });

  it('lets a plain template through', () => {
    expect(templateRefusals(base, { wabaTemplatesV2: true })).toEqual([]);
  });

  it('ignores media for NONE, TEXT and LOCATION headers', () => {
    for (const attachmentType of ['NONE', 'text', 'Location']) {
      expect(
        templateRefusals(
          { ...base, attachmentType, mediaUrl: 'http://x.test/a' },
          { wabaTemplatesV2: false },
        ),
      ).toEqual([]);
    }
  });

  it('refuses unreachable media on every engine, even with the Meta switch off', () => {
    const out = templateRefusals(
      { ...base, attachmentType: 'IMAGE', mediaUrl: 'http://localhost/a.png' },
      { wabaTemplatesV2: false },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Cannot broadcast this template: Media URL must be HTTPS/);
  });

  it('applies the Meta guardrails only when the template was submitted and the switch is on', () => {
    const pending = { ...base, metaTemplateId: 'm1', metaStatus: 'PENDING' };
    expect(templateRefusals(pending, { wabaTemplatesV2: false })).toEqual([]);
    expect(
      templateRefusals({ ...pending, metaTemplateId: null }, { wabaTemplatesV2: true }),
    ).toEqual([]);
    expect(templateRefusals(pending, { wabaTemplatesV2: true })[0]).toMatch(
      /not approved by Meta yet \(status: PENDING\)/,
    );
  });

  it('refuses a paused template until the pause ends', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    const approved = { ...base, metaTemplateId: 'm1', metaStatus: 'approved' };
    const paused = { ...approved, pausedUntil: new Date('2026-10-02T12:30:00Z') };
    expect(templateRefusals(paused, { wabaTemplatesV2: true, now })[0]).toMatch(
      /paused until 2026-10-02 12:30/,
    );
    expect(
      templateRefusals(
        { ...approved, pausedUntil: new Date('2026-10-02T09:00:00Z') },
        { wabaTemplatesV2: true, now },
      ),
    ).toEqual([]);
  });

  it('refuses only a RED quality score, not UNKNOWN or YELLOW', () => {
    const approved = { ...base, metaTemplateId: 'm1', metaStatus: 'APPROVED' };
    expect(
      templateRefusals({ ...approved, qualityScore: 'RED' }, { wabaTemplatesV2: true })[0],
    ).toMatch(/RED/);
    for (const qualityScore of [null, 'UNKNOWN', 'YELLOW', 'GREEN']) {
      expect(templateRefusals({ ...approved, qualityScore }, { wabaTemplatesV2: true })).toEqual(
        [],
      );
    }
  });

  it('joins several reasons into one refusal', () => {
    const out = templateRefusals(
      { ...base, metaTemplateId: 'm1', metaStatus: 'PENDING', qualityScore: 'RED' },
      { wabaTemplatesV2: true },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/not approved.*RED/s);
  });
});
