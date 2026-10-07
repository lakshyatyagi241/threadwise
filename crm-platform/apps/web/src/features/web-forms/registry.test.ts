import { describe, expect, it } from 'vitest';
import { closedAppGate } from '@/components/shell/app-gate';
import { activeNavId } from '@/components/shell/nav-model';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import type { Capabilities } from '../_registry/types';
import { nav } from './nav';
import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS } from '@crm/contracts';
import { LIMIT_UNITS } from '../auth-registration-security/platform/lib/plan-editor-view';

/**
 * Forms is a Marketplace app that grants `form_builder` (docs/specs/forms-builder-app.md section 12.5): the menu entry exists only for a
 * workspace that has the app, and its routes close for one that has not. These checks hold the registration to that rule.
 */
const caps = (permissions: string[], features: string[]): Capabilities => ({
  permissions: new Set(permissions),
  planFeatures: new Set(features),
  channels: new Set(),
});
const READ = ['record.forms.read'];

describe('Forms menu entry', () => {
  it('is one entry in Campaigns, gated by the read permission and the app', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'forms',
      group: 'campaigns',
      href: '/forms',
      labelKey: 'web-forms.nav.forms',
      gates: { permission: 'record.forms.read', app: 'form_builder' },
    });
  });

  it('is removed, with no upgrade lock, when the workspace does not own the app', () => {
    expect(resolveNav(nav, caps(READ, ['automation'])).map((i) => i.id)).toEqual([]);
  });

  it('is shown, unlocked, when the app is owned (bought, comped or on the plan)', () => {
    const r = resolveNav(nav, caps(READ, ['form_builder']));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'forms', locked: false });
  });

  it('is hidden from someone without the permission, even when the app is owned', () => {
    expect(resolveNav(nav, caps([], ['form_builder']))).toEqual([]);
  });

  it('removes nothing while the entitlements are not known yet', () => {
    expect(resolveNav(nav, CAPABILITIES_UNKNOWN).map((i) => i.id)).toEqual(['forms']);
  });
});

describe('Forms routes', () => {
  const gates = nav.flatMap((n) =>
    n.gates?.app ? [{ href: n.href, feature: n.gates.app, labelKey: n.labelKey }] : [],
  );

  it('closes /forms and every depth below it for a workspace without the app', () => {
    for (const path of [
      '/forms',
      '/forms/templates',
      '/forms/5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
      '/forms/5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11/submissions',
    ]) {
      expect(closedAppGate(path, gates, ['automation'])?.feature, path).toBe('form_builder');
      expect(closedAppGate(path, gates, ['form_builder']), path).toBeNull();
    }
  });

  it('does not close the pages around it, and never closes the public form', () => {
    for (const path of ['/forms-archive', '/contacts', '/f/AbCdEfGhIjKlMnOpQrStUv']) {
      expect(closedAppGate(path, gates, ['automation']), path).toBeNull();
    }
  });

  it('closes nothing while the entitlements are unknown', () => {
    expect(closedAppGate('/forms', gates, null)).toBeNull();
  });

  it('lights the menu entry up on every Forms screen', () => {
    const resolved = resolveNav(nav, caps(READ, ['form_builder']));
    for (const path of [
      '/forms',
      '/forms/templates',
      '/forms/5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
    ]) {
      expect(activeNavId(resolved, [], path), path).toBe('forms');
    }
  });
});

describe('Forms plan registry', () => {
  it('has the app feature and the three limits, each with a unit for the plan editor', () => {
    expect(PLAN_FEATURE_KEYS).toContain('form_builder');
    for (const key of [
      'forms',
      'form_submissions_monthly',
      'ai_form_generations_monthly',
    ] as const) {
      expect(PLAN_LIMIT_KEYS).toContain(key);
      expect(LIMIT_UNITS[key], key).toBeDefined();
    }
  });
});
