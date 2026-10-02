import { describe, expect, it } from 'vitest';
import { SET_GROUP_SCHEMAS, SET_SECRET_FIELDS, SET_GROUPS } from '@crm/contracts';
import { GROUP_SPECS, allFields, specById, specBySlug } from '../fields';
import { buildPatch, fieldForPath, patchSize, toDraft } from './draft';

const defaults = (g: keyof typeof SET_GROUP_SCHEMAS) =>
  SET_GROUP_SCHEMAS[g].parse({}) as Record<string, unknown>;

/** Groups edited by a component of their own instead of the generic form. */
const CUSTOM_GROUPS = ['tiPwa'];
/** Fields a custom component (the brand-file uploader) draws, so the generic form has no control for them. */
const UPLOADED = (k: string) => k === 'faviconUrl' || k.startsWith('logos.');

describe('settings screens cover the API groups', () => {
  it('has a screen for every group, with unique slugs and ids', () => {
    expect([...new Set(GROUP_SPECS.map((s) => s.group))].sort()).toEqual(
      SET_GROUPS.filter((g) => !CUSTOM_GROUPS.includes(g)).sort(),
    );
    expect(new Set(GROUP_SPECS.map((s) => s.slug)).size).toBe(GROUP_SPECS.length);
    expect(new Set(GROUP_SPECS.map((s) => s.id)).size).toBe(GROUP_SPECS.length);
    expect(specBySlug('site-info')?.group).toBe('site');
    expect(specBySlug('footer')?.group).toBe('site');
    expect(specBySlug('nope')).toBeUndefined();
  });

  it('every non-secret API field has a control, every secret a secret box, and nothing extra', () => {
    for (const group of SET_GROUPS.filter((g) => !CUSTOM_GROUPS.includes(g))) {
      const apiKeys = new Set<string>();
      for (const [k, v] of Object.entries(defaults(group))) {
        if (v && typeof v === 'object' && !Array.isArray(v))
          for (const sub of Object.keys(v)) apiKeys.add(`${k}.${sub}`);
        else apiKeys.add(k);
      }
      for (const s of SET_SECRET_FIELDS[group]) apiKeys.add(s);
      const specKeys = new Set(
        GROUP_SPECS.filter((s) => s.group === group).flatMap((s) => allFields(s).map((f) => f.key)),
      );
      const expected = [...apiKeys].filter((k) => !(group === 'branding' && UPLOADED(k)));
      expect([...specKeys].sort(), group).toEqual(expected.sort());
    }
  });

  it('a screen with secrets marks exactly those fields as secret', () => {
    for (const spec of GROUP_SPECS) {
      const secretKeys = allFields(spec)
        .filter((f) => f.kind === 'secret')
        .map((f) => f.key)
        .sort();
      expect(secretKeys, spec.id).toEqual([...SET_SECRET_FIELDS[spec.group]].sort());
    }
  });
});

describe('buildPatch', () => {
  const general = specById('general');

  it('sends nothing when nothing changed', () => {
    const v = defaults('general');
    const p = buildPatch(v, toDraft(v, general), general);
    expect(patchSize(p)).toBe(0);
    expect(p.problems).toEqual({});
  });

  it('sends only what changed, with toggles as booleans', () => {
    const v = defaults('general');
    const d = toDraft(v, general);
    d.fields.appName = 'Acme Chat';
    d.fields.maintenanceMode = true;
    expect(buildPatch(v, d, general).values).toEqual({
      appName: 'Acme Chat',
      maintenanceMode: true,
    });
  });

  it('sends a whole nested object when one member changed, and none when none did', () => {
    const branding = specById('appearance');
    const v = defaults('branding');
    const d = toDraft(v, branding);
    expect(buildPatch(v, d, branding).values).toEqual({});
    d.fields['colors.wa-deep'] = '#7C3AED';
    const { values } = buildPatch(v, d, branding);
    expect(Object.keys(values)).toEqual(['colors']);
    expect((values.colors as Record<string, string>)['wa-deep']).toBe('#7C3AED');
    expect(Object.keys(values.colors as object)).toHaveLength(16);
    // what the form builds must be acceptable to the API's own schema
    expect(SET_GROUP_SCHEMAS.branding.safeParse(values).success).toBe(true);
  });

  it('numbers: parsed, and a blank or fractional one is a problem, not a request', () => {
    const mail = specById('mail');
    const v = defaults('mail');
    const d = toDraft(v, mail);
    d.fields.port = '2525';
    expect(buildPatch(v, d, mail).values).toEqual({ port: 2525 });
    d.fields.port = '';
    expect(buildPatch(v, d, mail).problems).toEqual({ port: 'required' });
    d.fields.port = '25.5';
    expect(buildPatch(v, d, mail).problems).toEqual({ port: 'integer' });
  });

  it('secrets: blank keeps, typed replaces, clear removes (clear wins over typed)', () => {
    const mail = specById('mail');
    const v = defaults('mail');
    const d = toDraft(v, mail);
    expect(buildPatch(v, d, mail).secrets).toEqual({});
    d.secrets.password = 'hunter2';
    expect(buildPatch(v, d, mail).secrets).toEqual({ password: 'hunter2' });
    d.clear.password = true;
    expect(buildPatch(v, d, mail).secrets).toEqual({ password: null });
    expect(patchSize(buildPatch(v, d, mail))).toBe(1);
  });

  it('secrets never appear in the draft fields (they are not part of the saved values)', () => {
    const mail = specById('mail');
    expect(Object.keys(toDraft(defaults('mail'), mail).fields)).not.toContain('password');
  });
});

describe('fieldForPath', () => {
  const branding = specById('appearance');
  it('maps API error paths to controls', () => {
    expect(fieldForPath('values.appUrl', specById('general'))).toBe('appUrl');
    expect(fieldForPath('values.colors.ink-900', branding)).toBe('colors.ink-900');
    expect(fieldForPath('values.colors', branding)).toBe('colors.wa-deep');
    expect(fieldForPath('values.nope', branding)).toBeNull();
  });
});
