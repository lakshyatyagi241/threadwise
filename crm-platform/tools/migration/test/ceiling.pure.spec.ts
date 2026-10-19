import { describe, expect, it } from 'vitest';
import { closedKeys, loadModuleCeiling, oldWorkspaceKeys } from '../access/ceiling';
import { loadAccessConfig } from '../access/config';
import type { CatalogueRow } from '../extract/catalogue';

const row = (id: string, rolesWithAccess: number): CatalogueRow => ({
  id,
  name: id,
  label: '',
  type: '',
  hasCrud: true,
  inCatalogue: true,
  rolesWithAccess,
  status: 'mapped',
  candidate: null,
});

describe('module ceiling', () => {
  const map = loadAccessConfig().permissionMap;
  const target = [
    'record.contacts.read',
    'record.companies.read',
    'record.company-properties.read',
    'record.deals.read',
    'record.pipelines.read',
    'mail.templates.read',
    'mail.mailboxes.read',
    'fb.posts.read',
    'record.invoices.read',
    'inbox.conversation.read',
  ];

  it('holds only the keys of permissions a live role has accessible', () => {
    const keys = oldWorkspaceKeys([row('contacts_crud', 2), row('deal_crud', 0)], map);
    expect(keys.has('record.contacts.read')).toBe(true);
    expect(keys.has('record.deals.read')).toBe(false);
  });

  it('closes a module with no old key, keeps one with a key, never touches a key outside every module', () => {
    const old = oldWorkspaceKeys([row('contacts_crud', 1), row('deal_crud', 1)], map);
    const r = closedKeys(loadModuleCeiling(), old, target);
    expect(r.kept).toContain('deals');
    expect(r.closed).toEqual(expect.arrayContaining(['companies', 'email', 'facebook', 'sales-docs']));
    expect(r.keys).toEqual(
      expect.arrayContaining([
        'record.companies.read',
        'record.company-properties.read',
        'mail.templates.read',
        'mail.mailboxes.read',
        'fb.posts.read',
        'record.invoices.read',
      ]),
    );
    expect(r.keys).not.toContain('record.contacts.read');
    expect(r.keys).not.toContain('record.deals.read');
    expect(r.keys).not.toContain('record.pipelines.read');
    expect(r.keys).not.toContain('inbox.conversation.read');
  });

  it('never keeps the website chat, and closes the AI agents unless a Waboo permission maps into them', () => {
    const t = [...target, 'wgt.widgets.read', 'wgt.widgets.create', 'aiag.training.read', 'aiag.training.create'];
    // even a Waboo bot permission that maps across the website part leaves the website chat closed
    const r = closedKeys(loadModuleCeiling(), new Set(['wgt.widgets.read', 'record.deals.read']), t);
    expect(r.closed).toContain('website-chat');
    expect(r.keys).toEqual(expect.arrayContaining(['wgt.widgets.read', 'wgt.widgets.create']));
    expect(r.closed).toContain('ai-agents');
    expect(r.keys).toEqual(expect.arrayContaining(['aiag.training.read', 'aiag.training.create']));
    expect(closedKeys(loadModuleCeiling(), new Set(['aiag.training.read']), t).closed).not.toContain('ai-agents');
    // the AI Studio page has its own key and is never kept, whatever the old roles held
    const s = closedKeys(loadModuleCeiling(), new Set(['flb.ai_studio.read']), [...t, 'flb.ai_studio.read', 'flb.flows.read']);
    expect(s.closed).toContain('ai-studio');
    expect(s.keys).toContain('flb.ai_studio.read');
    expect(s.keys).not.toContain('flb.flows.read');
  });

  it('keeps a module when the old workspace held any key in it', () => {
    const old = new Set(['record.companies.read']);
    expect(closedKeys(loadModuleCeiling(), old, target).closed).not.toContain('companies');
  });
});
