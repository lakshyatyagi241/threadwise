import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { registrationConfigResponseSchema } from '@crm/contracts';
import { AuthShell } from './auth-shell';
import { frameProps } from './frame-props';
import { makeConfig, renderGuest } from './render-test-utils';

const config = makeConfig({
  appName: 'Acme',
  authPages: {
    variant: 1,
    login: { accent: '#25d366' },
    register: {},
    forgot: {},
    defaulted: { login: [], register: [], forgot: [] },
    extra: {
      login: { footer: 'Login footer' },
      register: { footer: 'Register footer' },
      forgot: {
        footer: 'Forgot footer line',
        hero_title: 'Forgot hero title',
        hero_desc: 'Forgot hero text',
      },
    },
  },
});

const render = (page: 'login' | 'register' | 'forgot', variant?: number) =>
  renderGuest(
    createElement(AuthShell, {
      ...frameProps(config, page, variant),
      page,
      header: { title: 'Title' },
      children: createElement('form'),
    }),
  );

describe('frameProps', () => {
  it('hands each page its own extras, the forgot page included', () => {
    expect(frameProps(config, 'login').extra).toEqual({ footer: 'Login footer' });
    expect(frameProps(config, 'register').extra).toEqual({ footer: 'Register footer' });
    expect(frameProps(config, 'forgot').extra).toMatchObject({ footer: 'Forgot footer line' });
  });

  it('lets one page override the admin design without touching the rest', () => {
    expect(frameProps(config, 'forgot', 3).variant).toBe(3);
    expect(frameProps(config, 'forgot').variant).toBe(1);
  });

  it('shows the footer and hero the admin saved on the Forgot tab on the real page (design 1)', () => {
    const html = render('forgot');
    expect(html).toContain('Forgot footer line');
    expect(html).toContain('Forgot hero title');
    expect(html).toContain('Forgot hero text');
    expect(html).not.toContain('Login footer');
  });

  it('keeps the other pages on their own extras', () => {
    expect(render('login')).toContain('Login footer');
    expect(render('login')).not.toContain('Forgot footer line');
  });

  it('falls back to the built-in closing line when the forgot page has no extras', () => {
    const bare = makeConfig({
      appName: 'Acme',
      authPages: { ...config.authPages, extra: { login: {}, register: {}, forgot: {} } },
    });
    const html = renderGuest(
      createElement(AuthShell, {
        ...frameProps(bare, 'forgot'),
        page: 'forgot',
        header: { title: 'Title' },
        children: createElement('form'),
      }),
    );
    expect(html).toContain(`${new Date().getFullYear()} Acme`);
  });

  it('parses an answer from an API that predates the forgot extras (the contract defaults them)', () => {
    const old = JSON.parse(JSON.stringify(config)) as {
      authPages: { extra: Record<string, unknown> };
    };
    delete old.authPages.extra.forgot;
    const parsed = registrationConfigResponseSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.authPages.extra.forgot).toEqual({});
  });
});
