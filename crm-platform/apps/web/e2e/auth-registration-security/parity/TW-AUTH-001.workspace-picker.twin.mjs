// Twin spec, ours only: the workspace cards shown after a sign-in whose email and password opened several
// workspaces. Reference signs in with email and password and has no such step, so there is nothing to compare;
// the scenarios are judged on absolute expectations (cards render, the pick posts the right slug, failures
// leave the cards usable, no double submit, no script errors). The API is mocked at the browser's network layer:
// nothing is written to any database and no credentials are used. Backend behaviour is covered by the API e2e.
const WORKSPACES = [
  { slug: 'alpha-co', name: 'Alpha Co', role: 'Owner', memberCount: 4 },
  { slug: 'beta-labs', name: 'Beta Labs', role: 'Agent', memberCount: 1 },
];
const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export default (h) => {
  async function toCards(c, pick) {
    const calls = [];
    await c.context.route('**/api/auth/login', (r) =>
      json(r, 200, {
        status: 'workspace_required',
        selectionToken: 'tok-test',
        expiresInSeconds: 300,
        workspaces: WORKSPACES,
      }),
    );
    await c.context.route('**/api/auth/login-workspace', async (r) => {
      calls.push(JSON.parse(r.request().postData() ?? '{}'));
      await pick(r, calls);
    });
    await c.goto('/login', { ready: 'input[type=password]' });
    await c.fill('input[name=email]', 'someone@example.test');
    await c.fill('input[name=password]', 'not-a-real-password');
    await c.press('Enter');
    await c.page.getByRole('list', { name: /workspace/i }).waitFor({ timeout: 15000 });
    return calls;
  }
  const cards = (c) => c.page.getByRole('list', { name: /workspace/i }).getByRole('button');

  const ok = (r) =>
    json(r, 200, {
      status: 'authenticated',
      orgSlug: 'beta-labs',
      landing: 'dashboard',
      flags: {},
    });

  return {
    feature: 'TW-AUTH-001',
    title: 'Sign-in: pick a workspace',
    skip: [],
    scenarios: [
      {
        id: 'picker.render',
        loggedIn: false,
        title: 'one card per workspace with name, slug, role and member count',
        run: async (c) => {
          const o = c.obs;
          await toCards(c, ok);
          const texts = await cards(c).allInnerTexts();
          o.flag('flag.cards.count', texts.length === 2);
          o.flag(
            'flag.cards.details',
            /Alpha Co/.test(texts[0]) &&
              /alpha-co/.test(texts[0]) &&
              /Owner/.test(texts[0]) &&
              /4/.test(texts[0]),
          );
          o.flag(
            'flag.credentialForm.hidden',
            (await c.page.locator('input[type=password]').count()) === 0,
          );
          await c.shot('cards');
        },
      },
      {
        id: 'picker.pick-posts-slug',
        loggedIn: false,
        title: 'clicking a card sends the token and that slug, once',
        run: async (c) => {
          const o = c.obs;
          const calls = await toCards(c, ok);
          await cards(c).nth(1).click();
          await c.afterAction({ quiet: 500 });
          o.flag('flag.post.once', calls.length === 1);
          o.flag(
            'flag.post.slug',
            calls[0]?.orgSlug === 'beta-labs' && calls[0]?.selectionToken === 'tok-test',
          );
        },
      },
      {
        id: 'picker.double-click',
        loggedIn: false,
        title: 'a second click while the pick is in flight is ignored',
        run: async (c) => {
          const o = c.obs;
          const calls = await toCards(c, async (r) => {
            await new Promise((res) => setTimeout(res, 800));
            await ok(r);
          });
          await cards(c).first().click();
          await cards(c)
            .first()
            .click({ force: true, timeout: 1000 })
            .catch(() => {});
          await c.afterAction({ quiet: 1200 });
          o.flag('flag.post.once', calls.length === 1);
        },
      },
      {
        id: 'picker.server-error',
        loggedIn: false,
        title: 'a failed pick shows the error and the cards stay usable',
        run: async (c) => {
          const o = c.obs;
          let first = true;
          const calls = await toCards(c, async (r) => {
            if (first) {
              first = false;
              return json(r, 500, {
                type: 'about:blank',
                code: 'INTERNAL',
                title: 'Internal',
                status: 500,
              });
            }
            return ok(r);
          });
          await cards(c).first().click();
          await c.page
            .getByRole('alert')
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          o.flag('flag.error.shown', (await c.page.getByRole('alert').count()) > 0);
          o.flag('flag.cards.stillThere', (await cards(c).count()) === 2);
          o.flag('flag.cards.enabled', await cards(c).first().isEnabled());
          await cards(c).first().click();
          await c.afterAction({ quiet: 500 });
          o.flag('flag.retry.posted', calls.length === 2);
        },
      },
      {
        id: 'picker.expired',
        loggedIn: false,
        title: 'an expired choice goes back to the sign-in form with a notice',
        run: async (c) => {
          const o = c.obs;
          await toCards(c, (r) =>
            json(r, 401, {
              type: 'about:blank',
              code: 'AUTH_MFA_CHALLENGE_EXPIRED',
              title: 'Unauthorized',
              status: 401,
              detail: 'That sign-in expired. Start again.',
            }),
          );
          await cards(c).first().click();
          await c.page
            .locator('input[type=password]')
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          o.flag('flag.backToForm', (await c.page.locator('input[type=password]').count()) > 0);
          o.flag('flag.notice.shown', (await c.page.getByRole('alert').count()) > 0);
        },
      },
      {
        id: 'picker.keyboard',
        loggedIn: false,
        title: 'cards are reachable and activatable with the keyboard',
        run: async (c) => {
          const o = c.obs;
          const calls = await toCards(c, ok);
          await c.page.keyboard.press('Tab');
          const focused = await c.page.evaluate(() => document.activeElement?.textContent ?? '');
          o.flag('flag.tab.reachesCard', /Alpha Co/.test(focused));
          await c.page.keyboard.press('Enter');
          await c.afterAction({ quiet: 500 });
          o.flag('flag.enter.posts', calls.length === 1 && calls[0].orgSlug === 'alpha-co');
        },
      },
      {
        id: 'picker.mobile',
        loggedIn: false,
        title: 'no horizontal scroll on a phone, long names truncate',
        run: async (c) => {
          const o = c.obs;
          const m = await c.openAlso({ viewport: { width: 375, height: 700 }, loggedIn: false });
          const long = { ...WORKSPACES[0], name: 'A very long workspace name '.repeat(6) };
          await m.page.route('**/api/auth/login', (r) =>
            json(r, 200, {
              status: 'workspace_required',
              selectionToken: 't',
              expiresInSeconds: 300,
              workspaces: [long, WORKSPACES[1]],
            }),
          );
          await m.page.goto(`${process.env.PARITY_WEB_URL}/login`);
          await m.page.fill('input[name=email]', 'someone@example.test');
          await m.page.fill('input[name=password]', 'not-a-real-password');
          await m.page.keyboard.press('Enter');
          await m.page.getByRole('list', { name: /workspace/i }).waitFor({ timeout: 15000 });
          const over = await m.page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          o.flag('sec.horizontalScroll', over);
        },
      },
    ],
  };
};
