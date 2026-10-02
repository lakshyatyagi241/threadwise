// Twin spec for the admin rail (WD-ASHELL-003/004/005): the same scenarios on the WaDesk admin console and on ours.
// Every scenario signs in itself because our console is a separate operator login, not the staff login the harness
// does by default. Observations are side-neutral: they describe what a user can see, never a selector or a wording.
// Local seeded dev accounts only; nothing is written on either side beyond the sidebar preference cookie.
const OURS = { email: 'e2e-support@example.test', password: 'E2e-Console-Pass1' };
const WADESK = { email: 'test@example.com', password: 'password' };

export default () => {
  const rail = {
    wadesk: 'aside',
    ours: '#console-sidebar',
  };
  const toggle = {
    wadesk: '#admin-sidebar-toggle',
    ours: '[data-testid=console-sidebar-toggle]',
  };

  // The reference runs from a Windows bind mount here and a cold page takes many seconds; the harness's
  // default action timeout is shorter than that.
  const patient = (c) => c.page.setDefaultTimeout(120000);

  async function signIn(c) {
    patient(c);
    if (c.side === 'wadesk') {
      await c.goto('/login', { ready: 'input[type=password]' });
      await c.page.fill('input[name=email]', WADESK.email);
      await c.page.fill('input[name=password]', WADESK.password);
      await Promise.all([
        c.page.waitForURL((u) => /\/(admin|dashboard|home)/.test(u.pathname), { timeout: 120000 }),
        c.page.click('button[type=submit]'),
      ]);
    } else {
      await c.goto('/admin/login', { ready: 'input[type=password]' });
      await c.page.fill('input[name=email]', OURS.email);
      await c.page.fill('input[name=password]', OURS.password);
      await Promise.all([
        c.page.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 60000 }),
        c.page.click('button[type=submit]'),
      ]);
    }
    await c.goto('/admin', { ready: rail[c.side] });
  }

  const width = async (c) => (await c.page.locator(rail[c.side]).first().boundingBox())?.width ?? 0;
  const hasSidebarCookie = async (c) =>
    (await c.context.cookies()).some((k) => /sidebar/i.test(k.name) && k.value === 'collapsed');

  return {
    feature: 'WD-ASHELL-005',
    title: 'Admin rail: collapse, remembered state, phone drawer, guest access (also 003 and 004)',
    scenarios: [
      {
        id: 'shell.guest.redirected',
        title: 'A guest opening the console is sent to a sign-in page',
        loggedIn: false,
        run: async (c) => {
          patient(c);
          await c.goto('/admin', { ready: 'body' });
          c.obs.flag('guest.sentToSignIn', /login/i.test(new URL(c.page.url()).pathname));
          // The console's own collapse button marks the console; a bare <aside> also appears on WaDesk's sign-in page.
          c.obs.flag('guest.consoleHidden', (await c.page.locator(toggle[c.side]).count()) === 0);
        },
      },
      {
        id: 'shell.rail.collapse',
        title: 'The rail collapses to icons, remembers it and expands again',
        loggedIn: false,
        run: async (c) => {
          await c.page.setViewportSize({ width: 1280, height: 800 });
          await signIn(c);
          const open = await width(c);
          c.obs.flag('rail.present', open > 0);
          c.obs.flag(
            'rail.toggleVisible',
            await c.page.locator(toggle[c.side]).first().isVisible(),
          );

          await c.page.locator(toggle[c.side]).first().click();
          await c.page.waitForTimeout(600);
          const shut = await width(c);
          c.obs.flag('collapse.narrower', shut < open / 2);
          c.obs.flag('collapse.cookieSet', await hasSidebarCookie(c));

          await c.page.reload({ waitUntil: 'load' });
          c.obs.flag('collapse.survivesReload', (await width(c)) < open / 2);

          await c.page.locator(toggle[c.side]).first().click();
          await c.page.waitForTimeout(600);
          c.obs.flag('expand.restores', (await width(c)) > open * 0.9);
        },
      },
      {
        id: 'shell.rail.phone',
        title: 'On a phone the rail is off-screen and the page does not scroll sideways',
        loggedIn: false,
        run: async (c) => {
          await c.page.setViewportSize({ width: 390, height: 844 });
          await signIn(c);
          const box = await c.page.locator(rail[c.side]).first().boundingBox();
          const onScreen = box ? box.x + box.width > 0 && box.x < 390 && box.width > 0 : false;
          c.obs.flag('phone.railOffScreen', !onScreen);
          // What matters to a user is whether the button can be seen: WaDesk keeps it inside the off-canvas
          // drawer (rendered but off-screen), ours hides it on phones. Both mean "not on screen".
          const t = await c.page.locator(toggle[c.side]).first().boundingBox();
          c.obs.flag('phone.toggleOffScreen', !t || t.x + t.width <= 0 || t.x >= 390);
          const overflow = await c.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          c.obs.flag('phone.noSidewaysScroll', overflow <= 0);
        },
      },
    ],
  };
};
